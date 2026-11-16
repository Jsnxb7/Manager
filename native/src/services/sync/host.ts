import { Catalog, validateCatalog } from '../../domain/catalog';
import { StorageAdapter } from '../../platform/contracts';
import { archiveCatalog } from '../transfer';
import { UpdateManifest, verifiedUpdateFile } from '../update';
import { Change, stable } from './merge';
import {
  PROTOCOL,
  ReplayGuard,
  SyncRequest,
  SyncResponse,
  verifyRequest,
} from './protocol';
import {
  CoverHashes,
  coverHashesIn,
  fromBase64,
  fromWire,
  loadCoverHashes,
  saveBase,
  saveCoverHashes,
  storeCover,
  toBase64,
  toWire,
} from './wire';

/** What the host needs from the open catalog. */
export type HostRepo = {
  snapshot(): Promise<Catalog>;
  replaceCatalog(
    candidate: Catalog,
    expectedRevision: string,
  ): Promise<Catalog>;
};
export type HostDeps = {
  key: () => string;
  repo: () => HostRepo | null;
  io: () => StorageAdapter | null;
  /** Called after the phone's merge is saved here. */
  onCommitted: (catalog: Catalog) => void;
  /**
   * A sync the phone proposes, for the person at the PC to approve or decline
   * with `decide`; null once it is settled or withdrawn.
   */
  onProposal?: (proposal: Proposal | null) => void;
  /** The PC's published release, if any (its APK is offered to the phone). */
  update?: () => Promise<UpdateManifest | null>;
  now?: () => number;
};

/** A merge the phone has confirmed, waiting for the PC's own yes. */
export type Proposal = {
  id: string;
  expectedRevision: string;
  /** What changes here, then on the phone. */
  changes: { toLocal: Change[]; toRemote: Change[] };
  status: 'waiting' | 'approved' | 'declined';
  /** The exact catalog approved: anything else is refused at commit. */
  fingerprint: string;
  at: number;
};
/** A proposal nobody answers lapses; the phone stops waiting by then too. */
export const PROPOSAL_TTL = 10 * 60 * 1000;

const json = (status: number, value: unknown): SyncResponse => ({
  status,
  body: JSON.stringify(value),
});

/**
 * Answers the phone. Every request must carry a valid signature; the phone does
 * the merging and sends the result back here.
 *   GET  /sync/hello            catalog id and revision
 *   GET  /sync/catalog          the catalog, covers as hashes
 *   GET  /sync/artwork/<sha>    one cover
 *   POST /sync/artwork/<sha>    store a cover the phone has and this PC lacks
 *   POST /sync/propose          the merged catalog, for the PC to approve
 *   GET  /sync/proposal/<id>    waiting, approved, declined or expired
 *   POST /sync/proposal/<id>/cancel   the phone stopped waiting
 *   POST /sync/commit           save the approved catalog if nothing changed meanwhile
 */
export function createHost(deps: HostDeps) {
  const guard = new ReplayGuard();
  const now = () => deps.now?.() ?? Date.now();
  let pending: Proposal | null = null;
  const settle = (next: Proposal | null) => {
    pending = next;
    deps.onProposal?.(next);
  };
  const live = () => {
    if (pending && now() - pending.at > PROPOSAL_TTL) {
      settle(null);
    }
    return pending;
  };
  let hashes: CoverHashes | null = null;
  const covers = async (io: StorageAdapter) =>
    (hashes ??= await loadCoverHashes(io));
  const handle = async (request: SyncRequest): Promise<SyncResponse> => {
    const refused = verifyRequest(deps.key(), request, guard, now());
    if (refused) {
      return json(401, { error: refused });
    }
    const repo = deps.repo();
    const io = deps.io();
    if (!repo || !io) {
      return json(503, { error: 'The library is still opening' });
    }
    try {
      const path = request.path.split('?')[0]!;
      if (request.method === 'GET' && path === '/sync/hello') {
        const catalog = await repo.snapshot();
        const release = (await deps.update?.()) ?? null;
        const android = release?.android;
        return json(200, {
          protocol: PROTOCOL,
          device: 'PC',
          catalogId: catalog.id,
          revision: catalog.revision,
          ...(release && android
            ? {
                update: {
                  version: release.version,
                  build: release.build,
                  size: android.size,
                  sha256: android.sha256,
                },
              }
            : {}),
        });
      }
      if (request.method === 'GET' && path === '/sync/update/apk') {
        const android = (await deps.update?.())?.android;
        if (!android) {
          return json(404, { error: 'No app update on the PC' });
        }
        // The native server sends the file itself, so 30 MB never passes through here.
        return {
          status: 200,
          body: `@file:${await verifiedUpdateFile(io, android)}`,
        };
      }
      if (request.method === 'GET' && path === '/sync/catalog') {
        const wire = await toWire(await repo.snapshot(), io, await covers(io));
        return json(200, {
          catalog: wire.catalog,
          missingCovers: wire.missingCovers,
        });
      }
      const artwork = /^\/sync\/artwork\/([0-9a-f]{64})$/.exec(path);
      if (artwork) {
        const hash = artwork[1]!;
        const known = await covers(io);
        if (request.method === 'GET') {
          // Any copy that is still on disk will do.
          let name: string | undefined;
          for (const candidate of Object.keys(known)) {
            if (
              known[candidate] === hash &&
              (await io.exists(`${io.privateRoot}/${candidate}`))
            ) {
              name = candidate;
              break;
            }
          }
          if (!name) {
            return json(404, { error: 'No such cover' });
          }
          return json(200, {
            data: toBase64(await io.readBytes(`${io.privateRoot}/${name}`)),
          });
        }
        const { data } = JSON.parse(request.body) as { data: string };
        await storeCover(io, hash, fromBase64(data), known);
        await saveCoverHashes(io, known);
        return json(200, { ok: true });
      }
      if (request.method === 'POST' && path === '/sync/propose') {
        const { expectedRevision, catalog, changes } = JSON.parse(
          request.body,
        ) as {
          expectedRevision: string;
          catalog: Catalog;
          changes: Proposal['changes'];
        };
        const wire = validateCatalog(catalog);
        const before = await repo.snapshot();
        if (before.revision !== expectedRevision) {
          return json(409, { error: 'The PC catalog changed; sync again' });
        }
        if (wire.id !== before.id) {
          return json(409, { error: 'Different catalog' });
        }
        const id = `proposal-${now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 10)}`;
        settle({
          id,
          expectedRevision,
          changes: {
            toLocal: Array.isArray(changes?.toLocal) ? changes.toLocal : [],
            toRemote: Array.isArray(changes?.toRemote) ? changes.toRemote : [],
          },
          status: 'waiting',
          fingerprint: stable(wire),
          at: now(),
        });
        return json(200, { id });
      }
      const asked = /^\/sync\/proposal\/([\w-]+)(\/cancel)?$/.exec(path);
      if (asked) {
        const current = live();
        const mine = current?.id === asked[1] ? current : null;
        if (request.method === 'POST' && asked[2]) {
          if (mine) {
            settle(null);
          }
          return json(200, { ok: true });
        }
        if (request.method === 'GET' && !asked[2]) {
          return json(200, { status: mine?.status ?? 'expired' });
        }
      }
      if (request.method === 'POST' && path === '/sync/commit') {
        const { expectedRevision, catalog, proposal } = JSON.parse(
          request.body,
        ) as {
          expectedRevision: string;
          catalog: Catalog;
          proposal?: string;
        };
        const wire = validateCatalog(catalog);
        // Nothing is saved here without a yes on this PC, for exactly this result.
        const approved = live();
        if (!proposal) {
          return json(426, {
            error: 'Update the app on your phone to sync with this PC',
          });
        }
        if (
          approved?.id !== proposal ||
          approved.status !== 'approved' ||
          approved.fingerprint !== stable(wire)
        ) {
          return json(403, { error: 'The PC has not approved this sync' });
        }
        const before = await repo.snapshot();
        if (before.revision !== expectedRevision) {
          return json(409, { error: 'The PC catalog changed; sync again' });
        }
        if (wire.id !== before.id) {
          return json(409, { error: 'Different catalog' });
        }
        const known = await covers(io);
        const names = new Map<string, string[]>();
        for (const [name, hash] of Object.entries(known)) {
          names.set(hash, [...(names.get(hash) ?? []), name]);
        }
        // Each cover maps to a copy that is really on disk.
        const files = new Map<string, string>();
        for (const hash of coverHashesIn(wire)) {
          for (const name of names.get(hash) ?? []) {
            if (await io.exists(`${io.privateRoot}/${name}`)) {
              files.set(hash, name);
              break;
            }
          }
          if (!files.has(hash)) {
            return json(400, { error: 'A cover is missing; send it first' });
          }
        }
        await archiveCatalog(io, before);
        const saved = await repo.replaceCatalog(
          fromWire(wire, files),
          expectedRevision,
        );
        await saveBase(io, wire);
        settle(null);
        deps.onCommitted(saved);
        return json(200, { revision: saved.revision });
      }
      return json(404, { error: 'Unknown request' });
    } catch (error) {
      return json(500, {
        error: (error as { message?: string })?.message ?? String(error),
      });
    }
  };
  /** The person at the PC answers the phone's proposal. */
  const decide = (id: string, approve: boolean) => {
    const current = live();
    if (current?.id === id && current.status === 'waiting') {
      settle({ ...current, status: approve ? 'approved' : 'declined' });
    }
  };
  return Object.assign(handle, { decide });
}
