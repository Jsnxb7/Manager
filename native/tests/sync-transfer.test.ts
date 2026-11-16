import {
  cloneCatalog,
  emptyCatalog,
  emptyMetadata,
} from '../src/domain/catalog';
import { JsonRepository } from '../src/repositories/JsonRepository';
import { createEntry } from '../src/services/library';
import {
  ReplayGuard,
  SyncTransport,
  formatKey,
  signRequest,
  verifyRequest,
} from '../src/services/sync/protocol';
import { Proposal, createHost } from '../src/services/sync/host';
import { finishSync, hello, prepareSync } from '../src/services/sync/client';
import { fromBase64, toBase64 } from '../src/services/sync/wire';
import { memoryStorage } from './memoryStorage';

const KEY = '0123456789abcdef0123456789abcdef';
// Smallest valid WebP-looking bytes: RIFF....WEBP plus some content.
const webp = (fill: number) =>
  new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46,
    0,
    0,
    0,
    0,
    0x57,
    0x45,
    0x42,
    0x50,
    fill,
    fill,
    fill,
  ]);

describe('sync request signing', () => {
  it('accepts a genuine request once and refuses tampering, old times and replays', () => {
    const now = 1_800_000_000_000;
    const guard = new ReplayGuard();
    const request = signRequest(KEY, 'POST', '/sync/commit', '{"a":1}', now);
    expect(verifyRequest(KEY, request, guard, now)).toBeNull();
    expect(verifyRequest(KEY, request, guard, now)).toBe('Repeated request');
    const tampered = {
      ...signRequest(KEY, 'POST', '/sync/commit', '{"a":1}', now),
      body: '{"a":2}',
    };
    expect(verifyRequest(KEY, tampered, new ReplayGuard(), now)).toBe(
      'Wrong sync key',
    );
    const other = signRequest('f'.repeat(32), 'GET', '/sync/hello', '', now);
    expect(verifyRequest(KEY, other, new ReplayGuard(), now)).toBe(
      'Wrong sync key',
    );
    const old = signRequest(
      KEY,
      'GET',
      '/sync/hello',
      '',
      now - 10 * 60 * 1000,
    );
    expect(verifyRequest(KEY, old, new ReplayGuard(), now)).toMatch(/clocks/);
    expect(
      verifyRequest(
        KEY,
        { method: 'GET', path: '/sync/hello', body: '', headers: {} },
        guard,
        now,
      ),
    ).toBe('Unsigned request');
  });
  it('shows keys in readable groups and round-trips base64', () => {
    expect(formatKey(KEY)).toBe('0123-4567-89AB-CDEF-0123-4567-89AB-CDEF');
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253]);
    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
  });
});

/** A PC and a phone, each with its own storage and catalog repository. */
async function devices() {
  const pcStore = memoryStorage('pc');
  const phoneStore = memoryStorage('phone');
  const pc = new JsonRepository(pcStore.io, 'pc/library');
  const phone = new JsonRepository(phoneStore.io, 'phone/library');
  const start = emptyCatalog();
  const add = (title: string) =>
    createEntry(start, 'anime', {
      title,
      season: 'S1',
      status: 'Ongoing',
      link: 'https://example.com',
      episodeCount: 2,
      metadata: { ...emptyMetadata(), tags: ['Sample'] },
      cover: null,
      external: null,
    });
  const a = add('Alpha');
  add('Beta');
  // Same cover bytes under each device's own file name.
  pcStore.files.set('pc/artwork/import-1.webp', webp(7));
  phoneStore.files.set('phone/artwork/import-xyz.webp', webp(7));
  const pcStart = cloneCatalog(start);
  pcStart.entries[0]!.cover = 'artwork/import-1.webp';
  const phoneStart = cloneCatalog(start);
  phoneStart.entries[0]!.cover = 'artwork/import-xyz.webp';
  await pc.replaceCatalog(pcStart, (await pc.load()).revision);
  await phone.replaceCatalog(phoneStart, (await phone.load()).revision);
  let committed = 0;
  // The person at the PC: approves unless told otherwise.
  const pcAnswer = { approve: true as boolean | null, seen: [] as Proposal[] };
  const host = createHost({
    key: () => KEY,
    repo: () => pc,
    io: () => pcStore.io,
    onCommitted: () => committed++,
    onProposal: proposal => {
      if (proposal?.status === 'waiting') {
        pcAnswer.seen.push(proposal);
        if (pcAnswer.approve !== null) {
          host.decide(proposal.id, pcAnswer.approve);
        }
      }
    },
  });
  const transport: SyncTransport = request => host(request);
  const deps = { transport, key: KEY, io: phoneStore.io, repo: phone };
  return {
    pc,
    phone,
    pcStore,
    phoneStore,
    deps,
    a,
    host,
    pcAnswer,
    committed: () => committed,
  };
}

describe('PC <-> phone sync', () => {
  it('refuses a phone with the wrong key', async () => {
    const { deps } = await devices();
    await expect(hello({ ...deps, key: 'f'.repeat(32) })).rejects.toThrow(
      'Wrong sync key',
    );
  });

  it('merges both sides, moves only missing covers, and leaves both devices identical', async () => {
    const { pc, phone, pcStore, phoneStore, deps, a, committed } =
      await devices();
    expect((await hello(deps)).catalogId).toBe((await pc.snapshot()).id);
    // PC bookmarks Alpha; phone adds a title with a new cover and watches an episode.
    await pc.mutate(c => {
      c.entries[0]!.bookmarked = true;
    });
    phoneStore.files.set('phone/artwork/new.webp', webp(9));
    await phone.mutate(c => {
      c.entries[0]!.episodes[0]!.watched = true;
      const gamma = createEntry(c, 'anime', {
        title: 'Gamma',
        season: 'S1',
        status: 'Ongoing',
        link: 'https://example.com',
        episodeCount: 1,
        metadata: { ...emptyMetadata(), tags: ['Sample'] },
        cover: null,
        external: null,
      });
      gamma.cover = 'artwork/new.webp';
    });
    const prepared = await prepareSync(deps);
    expect(prepared.kind).toBe('merge');
    if (prepared.kind !== 'merge') return;
    expect(prepared.merge.conflicts).toEqual([]);
    await finishSync(deps, prepared);
    const pcNow = await pc.snapshot();
    const phoneNow = await phone.snapshot();
    expect(pcNow.revision).toBe(phoneNow.revision);
    const alphaPc = pcNow.entries.find(e => e.id === a.id)!;
    expect(alphaPc.bookmarked).toBe(true);
    expect(alphaPc.episodes[0]!.watched).toBe(true);
    // Each side keeps its own file name for the shared cover.
    expect(alphaPc.cover).toBe('artwork/import-1.webp');
    expect(phoneNow.entries.find(e => e.id === a.id)!.cover).toBe(
      'artwork/import-xyz.webp',
    );
    // The new cover reached the PC under a content-hash name.
    const gammaPc = pcNow.entries.find(e => e.title === 'Gamma')!;
    expect(gammaPc.cover).toMatch(/^artwork\/sync-[0-9a-f]{16}\.webp$/);
    expect(pcStore.files.has(`pc/${gammaPc.cover}`)).toBe(true);
    expect(committed()).toBe(1);
    // Nothing left to do afterwards.
    expect((await prepareSync(deps)).kind).toBe('inSync');
  });

  it('asks about a title changed differently on both sides and applies the choice', async () => {
    const { pc, phone, deps, a } = await devices();
    // An initial sync gives both a shared base.
    await pc.mutate(c => {
      c.entries[1]!.read = true;
    });
    const first = await prepareSync(deps);
    if (first.kind !== 'inSync') await finishSync(deps, first);
    await pc.mutate(c => {
      c.entries.find(e => e.id === a.id)!.title = 'Alpha (PC)';
    });
    await phone.mutate(c => {
      c.entries.find(e => e.id === a.id)!.title = 'Alpha (Phone)';
    });
    const prepared = await prepareSync(deps);
    if (prepared.kind !== 'merge') throw new Error('expected a merge');
    expect(prepared.merge.conflicts.map(c => c.id)).toEqual([a.id]);
    await finishSync(deps, prepared, { [a.id]: 'local' });
    expect((await pc.snapshot()).entries.find(e => e.id === a.id)!.title).toBe(
      'Alpha (Phone)',
    );
  });

  it('restores a cover file one device lost instead of wiping it on both', async () => {
    const { pc, phone, pcStore, phoneStore, deps, a } = await devices();
    const first = await prepareSync(deps);
    if (first.kind !== 'inSync') await finishSync(deps, first);
    // The phone loses its copy of Alpha's cover; its hash cache still knows it.
    phoneStore.files.delete('phone/artwork/import-xyz.webp');
    const prepared = await prepareSync(deps);
    if (prepared.kind !== 'merge') throw new Error('expected a merge');
    expect(prepared.merge.changes.toRemote).toEqual([]);
    expect(prepared.merge.changes.toLocal.map(c => c.details)).toEqual([
      ['Missing cover image restored'],
    ]);
    await finishSync(deps, prepared);
    expect((await pc.snapshot()).entries.find(e => e.id === a.id)!.cover).toBe(
      'artwork/import-1.webp',
    );
    const phoneCover = (await phone.snapshot()).entries.find(
      e => e.id === a.id,
    )!.cover!;
    expect(phoneStore.files.has(`phone/${phoneCover}`)).toBe(true);
    expect(pcStore.files.has('pc/artwork/import-1.webp')).toBe(true);
    expect((await prepareSync(deps)).kind).toBe('inSync');
  });

  it('keeps the phone cover when the PC lost its file, and sends it back', async () => {
    const { pc, pcStore, deps, a } = await devices();
    const first = await prepareSync(deps);
    if (first.kind !== 'inSync') await finishSync(deps, first);
    pcStore.files.delete('pc/artwork/import-1.webp');
    const prepared = await prepareSync(deps);
    if (prepared.kind !== 'merge') throw new Error('expected a merge');
    expect(prepared.merge.changes.toLocal).toEqual([]);
    await finishSync(deps, prepared);
    const cover = (await pc.snapshot()).entries.find(e => e.id === a.id)!
      .cover!;
    expect(cover).not.toBeNull();
    expect(pcStore.files.has(`pc/${cover}`)).toBe(true);
    expect((await prepareSync(deps)).kind).toBe('inSync');
  });

  it('drops a cover lost on both devices without failing the sync', async () => {
    const { phone, pcStore, phoneStore, deps, a } = await devices();
    const first = await prepareSync(deps);
    if (first.kind !== 'inSync') await finishSync(deps, first);
    pcStore.files.delete('pc/artwork/import-1.webp');
    phoneStore.files.delete('phone/artwork/import-xyz.webp');
    await phone.mutate(c => {
      c.entries[1]!.bookmarked = true;
    });
    const prepared = await prepareSync(deps);
    if (prepared.kind !== 'merge') throw new Error('expected a merge');
    await finishSync(deps, prepared);
    expect(
      (await phone.snapshot()).entries.find(e => e.id === a.id)!.cover,
    ).toBeNull();
  });

  it('asks the PC too, showing it the changes from its own side', async () => {
    const { pc, phone, deps, pcAnswer, a } = await devices();
    await phone.mutate(c => {
      c.entries.find(e => e.id === a.id)!.bookmarked = true;
    });
    const prepared = await prepareSync(deps);
    if (prepared.kind !== 'merge') throw new Error('expected a merge');
    let waited = false;
    await finishSync(deps, prepared, {}, { onWaiting: () => (waited = true) });
    expect(waited).toBe(true);
    expect(pcAnswer.seen).toHaveLength(1);
    // The PC's own side comes first: Alpha changes there.
    expect(pcAnswer.seen[0]!.changes.toLocal.map(c => c.details)).toEqual([
      ['Bookmarked'],
    ]);
    expect(
      (await pc.snapshot()).entries.find(e => e.id === a.id)!.bookmarked,
    ).toBe(true);
  });

  it('changes nothing anywhere when the PC declines', async () => {
    const { pc, phone, deps, pcAnswer, committed } = await devices();
    pcAnswer.approve = false;
    await phone.mutate(c => {
      c.entries[0]!.bookmarked = true;
    });
    const pcBefore = (await pc.snapshot()).revision;
    const phoneBefore = (await phone.snapshot()).revision;
    const prepared = await prepareSync(deps);
    if (prepared.kind !== 'merge') throw new Error('expected a merge');
    await expect(finishSync(deps, prepared)).rejects.toThrow(/declined/);
    expect((await pc.snapshot()).revision).toBe(pcBefore);
    expect((await phone.snapshot()).revision).toBe(phoneBefore);
    expect(committed()).toBe(0);
  });

  it('withdraws the request when the phone stops waiting', async () => {
    const { phone, deps, pcAnswer, committed } = await devices();
    pcAnswer.approve = null;
    await phone.mutate(c => {
      c.entries[0]!.bookmarked = true;
    });
    const prepared = await prepareSync(deps);
    if (prepared.kind !== 'merge') throw new Error('expected a merge');
    let stop = false;
    await expect(
      finishSync(
        deps,
        prepared,
        {},
        {
          cancelled: () => stop,
          pause: async () => {
            stop = true;
          },
        },
      ),
    ).rejects.toThrow(/cancelled/);
    expect(pcAnswer.seen).toHaveLength(1);
    expect(committed()).toBe(0);
  });

  it('refuses a commit the PC did not approve', async () => {
    const { phone, deps, host, committed } = await devices();
    await phone.mutate(c => {
      c.entries[0]!.bookmarked = true;
    });
    const prepared = await prepareSync(deps);
    if (prepared.kind !== 'merge') throw new Error('expected a merge');
    const commit = (proposal?: string) =>
      host(
        signRequest(
          KEY,
          'POST',
          '/sync/commit',
          JSON.stringify({
            expectedRevision: prepared.remote.revision,
            catalog: prepared.merge.catalog,
            ...(proposal ? { proposal } : {}),
          }),
        ),
      );
    expect((await commit()).status).toBe(426);
    expect((await commit('proposal-made-up')).status).toBe(403);
    expect(committed()).toBe(0);
  });

  it('refuses to commit when the PC changed after the phone looked', async () => {
    const { pc, phone, deps } = await devices();
    await phone.mutate(c => {
      c.entries[0]!.bookmarked = true;
    });
    const prepared = await prepareSync(deps);
    if (prepared.kind !== 'merge') throw new Error('expected a merge');
    await pc.mutate(c => {
      c.entries[1]!.bookmarked = true;
    });
    await expect(finishSync(deps, prepared)).rejects.toThrow(/changed/);
    // Nothing was half-applied on the phone.
    expect((await phone.snapshot()).entries[1]!.bookmarked).toBe(false);
  });
});
