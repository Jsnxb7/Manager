import { Catalog, validateCatalog } from '../../domain/catalog';
import { StorageAdapter } from '../../platform/contracts';
import { archiveCatalog } from '../transfer';
import {
  Change,
  Choice,
  MergeResult,
  describeChanges,
  fillMissingCovers,
  mergeCatalogs,
  resolveConflicts,
} from './merge';
import { PROTOCOL, SyncTransport, signRequest } from './protocol';
import {
  CoverHashes,
  coverHashesIn,
  fromBase64,
  fromWire,
  loadBase,
  loadCoverHashes,
  saveBase,
  saveCoverHashes,
  storeCover,
  toBase64,
  toWire,
} from './wire';

export type ClientRepo = {
  snapshot(): Promise<Catalog>;
  replaceCatalog(
    candidate: Catalog,
    expectedRevision: string,
  ): Promise<Catalog>;
};
export type ClientDeps = {
  transport: SyncTransport;
  key: string;
  io: StorageAdapter;
  repo: ClientRepo;
};
export type Hello = {
  catalogId: string;
  revision: string;
  /** A newer phone app the PC can hand over. */
  update?: { version: string; build: number; size: number; sha256: string };
};

/** A sync worked out and waiting for the person's go-ahead. */
export type Prepared =
  | { kind: 'inSync' }
  | {
      kind: 'merge';
      merge: MergeResult;
      localRevision: string;
      remote: Catalog;
      /** Cover hashes whose files the PC holds. */
      remoteCovers: Set<string>;
      sides: Sides;
      files: Map<string, string>;
    }
  | {
      /** The PC holds a different catalog: the only choice is to take it whole. */
      kind: 'different';
      localRevision: string;
      remote: Catalog;
      files: Map<string, string>;
    };

export class SyncError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

async function call<T>(
  deps: Pick<ClientDeps, 'transport' | 'key'>,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await deps.transport(
    signRequest(
      deps.key,
      method,
      path,
      body === undefined ? '' : JSON.stringify(body),
    ),
  );
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    // ngrok's own error pages are HTML.
  }
  if (response.status !== 200) {
    const message =
      (parsed as { error?: string } | null)?.error ??
      (response.status === 404 || response.status >= 500
        ? 'The PC is not sharing right now'
        : `The PC answered ${response.status}`);
    throw new SyncError(message, response.status);
  }
  return parsed as T;
}

/** One quick look: is the PC there, and is it ours? */
export async function hello(
  deps: Pick<ClientDeps, 'transport' | 'key'>,
): Promise<Hello> {
  const reply = await call<Hello & { protocol: number }>(
    deps,
    'GET',
    '/sync/hello',
  );
  if (reply.protocol !== PROTOCOL) {
    throw new SyncError('Update the app on both devices to sync');
  }
  return reply;
}

export async function prepareSync(deps: ClientDeps): Promise<Prepared> {
  const local = await deps.repo.snapshot();
  const { catalog: remoteRaw, missingCovers: remoteMissing = [] } = await call<{
    catalog: Catalog;
    missingCovers?: string[];
  }>(deps, 'GET', '/sync/catalog');
  const remote = validateCatalog(remoteRaw);
  const hashes = await loadCoverHashes(deps.io);
  const mine = await toWire(local, deps.io, hashes);
  if (remote.id !== local.id) {
    return {
      kind: 'different',
      localRevision: local.revision,
      remote,
      files: mine.files,
    };
  }
  // Same revisions still go through the merge, which can tidy duplicate titles
  // an older sync left on both devices; unchanged content stops below.
  const base = await loadBase(deps.io, local.id);
  // Covers whose files the PC really has, before any gap is filled in below.
  const remoteCovers = coverHashesIn(remote);
  fillMissingCovers(
    base,
    mine.catalog,
    remote,
    mine.missingCovers,
    remoteMissing,
  );
  const merge = mergeCatalogs(base, mine.catalog, remote);
  const sides = {
    local: mine.catalog,
    remote,
    localMissing: mine.missingCovers,
    remoteMissing,
  };
  merge.changes = changesFor(sides, merge.catalog);
  if (
    !merge.changes.toLocal.length &&
    !merge.changes.toRemote.length &&
    !merge.conflicts.length
  ) {
    // Same content under different revisions: agree on one and stop.
    await saveBase(deps.io, remote);
    return { kind: 'inSync' };
  }
  return {
    kind: 'merge',
    merge,
    localRevision: local.revision,
    remote,
    remoteCovers,
    sides,
    files: mine.files,
  };
}

/** Both catalogs as the merge saw them, for describing any result. */
export type Sides = {
  local: Catalog;
  remote: Catalog;
  localMissing: string[];
  remoteMissing: string[];
};

/**
 * What a result changes on each device, title by title. A cover file that
 * comes back counts too, though the catalogs agree about it.
 */
export function changesFor(
  sides: Sides,
  result: Catalog,
): { toLocal: Change[]; toRemote: Change[] } {
  const restored = (missing: string[], to: Change[]) => {
    for (const id of missing) {
      const entry = result.entries.find(e => e.id === id);
      if (entry?.cover && !to.some(c => c.key === id)) {
        to.push({
          key: id,
          title: entry.season
            ? `${entry.title} (${entry.season})`
            : entry.title,
          kind: 'changed',
          details: ['Missing cover image restored'],
        });
      }
    }
    return to;
  };
  return {
    toLocal: restored(sides.localMissing, describeChanges(sides.local, result)),
    toRemote: restored(
      sides.remoteMissing,
      describeChanges(sides.remote, result),
    ),
  };
}

/** Waiting on the PC: told when the request is out, asked often whether to stop. */
export type WaitOptions = {
  onWaiting?: () => void;
  cancelled?: () => boolean;
  pause?: (ms: number) => Promise<void>;
  /** How long the person at the PC has to answer. */
  timeoutMs?: number;
};
const pauseFor = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/** Puts the merge to the PC and waits for its answer. */
async function askPc(
  deps: ClientDeps,
  expectedRevision: string,
  catalog: Catalog,
  changes: { toLocal: Change[]; toRemote: Change[] },
  options: WaitOptions,
): Promise<string> {
  // The PC sees its own side first: what changes there, then here.
  const { id } = await call<{ id: string }>(deps, 'POST', '/sync/propose', {
    expectedRevision,
    catalog,
    changes: { toLocal: changes.toRemote, toRemote: changes.toLocal },
  });
  options.onWaiting?.();
  const pause = options.pause ?? pauseFor;
  const until = Date.now() + (options.timeoutMs ?? 5 * 60 * 1000);
  const withdraw = () =>
    call(deps, 'POST', `/sync/proposal/${id}/cancel`).catch(() => undefined);
  for (;;) {
    if (options.cancelled?.()) {
      await withdraw();
      throw new SyncError('Sync cancelled', 499);
    }
    const { status } = await call<{ status: string }>(
      deps,
      'GET',
      `/sync/proposal/${id}`,
    );
    if (status === 'approved') {
      return id;
    }
    if (status === 'declined') {
      throw new SyncError('The PC declined this sync; nothing was changed');
    }
    if (status !== 'waiting') {
      throw new SyncError('The PC stopped waiting; sync again');
    }
    if (Date.now() > until) {
      await withdraw();
      throw new SyncError(
        'Nobody confirmed on the PC in time; nothing was changed',
      );
    }
    await pause(1500);
  }
}

/** Sends and receives covers, saves on the PC first, then here. */
export async function finishSync(
  deps: ClientDeps,
  prepared: Exclude<Prepared, { kind: 'inSync' }>,
  choices: Record<string, Choice> = {},
  options: WaitOptions = {},
): Promise<Catalog> {
  const target =
    prepared.kind === 'merge'
      ? resolveConflicts(
          prepared.merge.catalog,
          prepared.merge.conflicts,
          choices,
        )
      : prepared.remote;
  const hashes: CoverHashes = await loadCoverHashes(deps.io);
  const files = new Map(prepared.files);
  const remoteHas =
    prepared.kind === 'merge'
      ? prepared.remoteCovers
      : coverHashesIn(prepared.remote);
  const wanted = coverHashesIn(target);
  // First fetch what this device lacks: reading the PC changes nothing there.
  for (const hash of wanted) {
    const name = files.get(hash);
    if (!name) {
      let data: string;
      try {
        ({ data } = await call<{ data: string }>(
          deps,
          'GET',
          `/sync/artwork/${hash}`,
        ));
      } catch (error) {
        // Only the PC's own answer; a 404 from the tunnel means it is offline.
        if (
          !(error instanceof SyncError) ||
          error.status !== 404 ||
          error.message !== 'No such cover'
        ) {
          throw error;
        }
        // The PC cannot send it: keep this device's own cover for the title,
        // and only go without one when neither device has an image.
        for (const entry of target.entries) {
          if (entry.cover === `sha:${hash}`) {
            const own =
              prepared.kind === 'merge'
                ? prepared.sides.local.entries.find(e => e.id === entry.id)
                    ?.cover ?? null
                : null;
            const ownHash = own?.startsWith('sha:') ? own.slice(4) : null;
            entry.cover =
              ownHash && ownHash !== hash && files.has(ownHash) ? own : null;
          }
        }
        continue;
      }
      files.set(
        hash,
        await storeCover(deps.io, hash, fromBase64(data), hashes),
      );
    }
  }
  await saveCoverHashes(deps.io, hashes);
  // Check the result fits here before anything is saved anywhere.
  const local = fromWire(target, files);
  if ((await deps.repo.snapshot()).revision !== prepared.localRevision) {
    throw new SyncError('This device changed during the sync; sync again', 409);
  }
  if (prepared.kind === 'merge') {
    // The PC confirms too, seeing exactly this result; only then is it written to.
    const proposal = await askPc(
      deps,
      prepared.remote.revision,
      target,
      changesFor(prepared.sides, target),
      options,
    );
    for (const hash of coverHashesIn(target)) {
      const name = files.get(hash);
      if (name && !remoteHas.has(hash)) {
        await call(deps, 'POST', `/sync/artwork/${hash}`, {
          data: toBase64(
            await deps.io.readBytes(`${deps.io.privateRoot}/${name}`),
          ),
        });
      }
    }
    await call(deps, 'POST', '/sync/commit', {
      expectedRevision: prepared.remote.revision,
      catalog: target,
      proposal,
    });
  }
  const before = await deps.repo.snapshot();
  if (before.revision !== prepared.localRevision) {
    throw new SyncError('This device changed during the sync; sync again', 409);
  }
  await archiveCatalog(deps.io, before);
  const saved = await deps.repo.replaceCatalog(local, prepared.localRevision);
  await saveBase(deps.io, target);
  return saved;
}

/** HTTPS through the PC's ngrok domain. */
export function fetchTransport(
  domain: string,
  timeoutMs = 20000,
): SyncTransport {
  const host = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return async request => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`https://${host}${request.path}`, {
        method: request.method,
        headers: request.headers,
        body: request.method === 'POST' ? request.body : undefined,
        signal: controller.signal,
      });
      return { status: response.status, body: await response.text() };
    } catch {
      throw new SyncError(
        controller.signal.aborted
          ? 'The PC did not answer in time'
          : 'Cannot reach the PC through ngrok',
      );
    } finally {
      clearTimeout(timer);
    }
  };
}
