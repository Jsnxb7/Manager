import {
  Catalog,
  cloneCatalog,
  emptyCatalog,
  emptyMetadata,
  validateCatalog,
} from '../src/domain/catalog';
import { createEntry } from '../src/services/library';
import { addRelation } from '../src/services/relations';
import {
  fillMissingCovers,
  mergeCatalogs,
  resolveConflicts,
} from '../src/services/sync/merge';

function setup() {
  const base = emptyCatalog();
  const add = (c: Catalog, title: string, season = 'S1', episodes = 3) =>
    createEntry(c, 'anime', {
      title,
      season,
      status: 'Ongoing',
      link: 'https://example.com',
      episodeCount: episodes,
      metadata: { ...emptyMetadata(), tags: ['Sample'] },
      cover: null,
      external: null,
    });
  const a = add(base, 'Alpha');
  const b = add(base, 'Beta');
  const local = cloneCatalog(base);
  const remote = cloneCatalog(base);
  return { base, local, remote, a, b, add };
}
const entry = (c: Catalog, id: string) => c.entries.find(e => e.id === id)!;
const progress = (entryId: string, episodeId: string, at: string, t = 300) => ({
  entryId,
  episodeId,
  currentTime: t,
  duration: 1400,
  updatedAt: at,
});

describe('three-way catalog merge', () => {
  it('folds a title both devices added on their own into one', () => {
    const { base, local, remote, add } = setup();
    const mine = add(local, 'Nia Liston: Musouroku');
    const theirs = add(remote, 'Nia Liston- Musouroku');
    theirs.relativeFolder = mine.relativeFolder;
    theirs.episodes[1]!.watched = true;
    theirs.bookmarked = true;
    remote.queue = [theirs.id];
    remote.progress[theirs.episodes[2]!.id] = progress(
      theirs.id,
      theirs.episodes[2]!.id,
      '2026-01-01T00:00:00Z',
    );
    const { catalog } = mergeCatalogs(base, local, remote);
    const copies = catalog.entries.filter(e => e.title.startsWith('Nia'));
    expect(copies.map(e => e.id)).toEqual([mine.id]);
    expect(copies[0]!.bookmarked).toBe(true);
    expect(copies[0]!.episodes[1]!.watched).toBe(true);
    expect(catalog.queue).toEqual([mine.id]);
    expect(catalog.progress[mine.episodes[2]!.id]?.entryId).toBe(mine.id);
    expect(entry(local, mine.id).bookmarked).toBe(false);
    expect(() => validateCatalog(catalog)).not.toThrow();
  });

  it('folds by MAL id and season, but keeps other seasons apart', () => {
    const { local, remote, add } = setup();
    const external = (malId: number) => ({
      provider: 'jikan' as const,
      malId,
      url: 'https://myanimelist.net',
      fetchedAt: '2026-01-01T00:00:00Z',
    });
    const s1 = add(local, 'Gamma');
    s1.external = external(7);
    const s2 = add(local, 'Gamma', 'S2');
    s2.external = external(7);
    const copy = add(remote, 'Gamma (TV)');
    copy.relativeFolder = 'elsewhere/S1';
    copy.external = external(7);
    const { catalog } = mergeCatalogs(null, local, remote);
    expect(
      catalog.entries.filter(e => e.title.startsWith('Gamma')).map(e => e.id),
    ).toEqual([s1.id, s2.id]);
  });

  it('takes one-sided additions, edits and deletions from either side', () => {
    const { base, local, remote, a, b, add } = setup();
    add(local, 'Gamma');
    entry(remote, a.id).bookmarked = true;
    remote.entries = remote.entries.filter(e => e.id !== b.id);
    const { catalog, conflicts } = mergeCatalogs(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(catalog.entries.map(e => e.title).sort()).toEqual([
      'Alpha',
      'Gamma',
    ]);
    expect(entry(catalog, a.id).bookmarked).toBe(true);
    expect(() => validateCatalog(catalog)).not.toThrow();
  });

  it('merges different fields edited on both sides without asking', () => {
    const { base, local, remote, a } = setup();
    entry(local, a.id).bookmarked = true;
    entry(remote, a.id).episodes[0]!.watched = true;
    entry(remote, a.id).metadata.tags.push('Comedy');
    entry(local, a.id).metadata.tags = [];
    const { catalog, conflicts } = mergeCatalogs(base, local, remote);
    expect(conflicts).toEqual([]);
    const merged = entry(catalog, a.id);
    expect(merged.bookmarked).toBe(true);
    expect(merged.episodes[0]!.watched).toBe(true);
    // Local removed "Sample", which stays; remote added "Comedy".
    expect(merged.metadata.tags).toEqual(['Sample', 'Comedy']);
  });

  it('asks only when the same field changed differently, and applies the choice', () => {
    const { base, local, remote, a } = setup();
    entry(local, a.id).title = 'Alpha (PC)';
    entry(remote, a.id).title = 'Alpha (Phone)';
    const result = mergeCatalogs(base, local, remote);
    expect(result.conflicts.map(c => c.id)).toEqual([a.id]);
    const keepRemote = resolveConflicts(result.catalog, result.conflicts, {
      [a.id]: 'remote',
    });
    expect(entry(keepRemote, a.id).title).toBe('Alpha (Phone)');
    expect(() => validateCatalog(keepRemote)).not.toThrow();
  });

  it('keeps an edited title that the other side deleted', () => {
    const { base, local, remote, a } = setup();
    local.entries = local.entries.filter(e => e.id !== a.id);
    entry(remote, a.id).bookmarked = true;
    const { catalog } = mergeCatalogs(base, local, remote);
    expect(entry(catalog, a.id).bookmarked).toBe(true);
  });

  it('takes the newest watch position and drops positions of watched episodes', () => {
    const { base, local, remote, a, b } = setup();
    const [ep1, ep2] = entry(base, a.id).episodes;
    local.progress[ep1!.id] = progress(
      a.id,
      ep1!.id,
      '2026-11-01T10:00:00Z',
      100,
    );
    remote.progress[ep1!.id] = progress(
      a.id,
      ep1!.id,
      '2026-11-02T10:00:00Z',
      500,
    );
    local.progress[ep2!.id] = progress(a.id, ep2!.id, '2026-11-01T10:00:00Z');
    // The phone finished episode 2.
    entry(remote, a.id).episodes[1]!.watched = true;
    const bEp = entry(base, b.id).episodes[0]!;
    remote.progress[bEp.id] = progress(b.id, bEp.id, '2026-11-03T10:00:00Z');
    const { catalog } = mergeCatalogs(base, local, remote);
    expect(catalog.progress[ep1!.id]!.currentTime).toBe(500);
    expect(catalog.progress[ep2!.id]).toBeUndefined();
    expect(catalog.progress[bEp.id]).toBeDefined();
    expect(() => validateCatalog(catalog)).not.toThrow();
  });

  it('keeps a position one side no longer has', () => {
    const { base, local, remote, a } = setup();
    const ep = entry(base, a.id).episodes[0]!;
    base.progress[ep.id] = progress(a.id, ep.id, '2026-11-01T10:00:00Z');
    local.progress[ep.id] = { ...base.progress[ep.id]! };
    remote.progress = {};
    expect(
      mergeCatalogs(base, local, remote).catalog.progress[ep.id]!.currentTime,
    ).toBe(300);
    local.progress[ep.id] = progress(a.id, ep.id, '2026-11-05T10:00:00Z', 900);
    expect(
      mergeCatalogs(base, local, remote).catalog.progress[ep.id]!.currentTime,
    ).toBe(900);
  });

  it('merges queue and relations from both sides and keeps separated pairs apart', () => {
    const { base, local, remote, a, b, add } = setup();
    base.queue = [a.id];
    local.queue = [a.id, b.id];
    remote.queue = [];
    const c = add(remote, 'Alpha', 'S2');
    remote.queue = [c.id];
    addRelation(remote, a.id, c.id);
    local.blockedPairs.push([a.id, b.id]);
    const { catalog, conflicts } = mergeCatalogs(base, local, remote);
    expect(conflicts).toEqual([]);
    // Remote dropped Alpha from the queue, which stays; both sides' additions join.
    expect(catalog.queue).toEqual([a.id, b.id, c.id]);
    expect(catalog.relations[0]!.entryIds.sort()).toEqual([a.id, c.id].sort());
    expect(catalog.blockedPairs).toHaveLength(1);
    expect(() => validateCatalog(catalog)).not.toThrow();
  });

  it('on a first sync without shared history, watched anywhere stays watched', () => {
    const { local, remote, a, add } = setup();
    entry(local, a.id).episodes[0]!.watched = true;
    entry(remote, a.id).episodes[1]!.watched = true;
    entry(remote, a.id).bookmarked = true;
    add(remote, 'Delta');
    const { catalog, conflicts } = mergeCatalogs(null, local, remote);
    expect(conflicts).toEqual([]);
    const merged = entry(catalog, a.id);
    expect(merged.episodes.map(e => e.watched)).toEqual([true, true, false]);
    expect(merged.bookmarked).toBe(true);
    expect(catalog.entries.some(e => e.title === 'Delta')).toBe(true);
  });

  it('keeps one episode when both sides added the same number', () => {
    const { base, local, remote, a } = setup();
    for (const [c, id] of [
      [local, 'local-ep'],
      [remote, 'remote-ep'],
    ] as const) {
      entry(c, a.id).episodes.push({
        id,
        number: 4,
        title: 'Episode 4',
        watched: false,
        relativeFile: '4.mp4',
        legacy: {},
      });
    }
    const { catalog } = mergeCatalogs(base, local, remote);
    expect(
      entry(catalog, a.id).episodes.filter(e => e.number === 4),
    ).toHaveLength(1);
    expect(() => validateCatalog(catalog)).not.toThrow();
  });

  it('reports nothing to do when both sides match', () => {
    const { base, local, remote } = setup();
    const result = mergeCatalogs(base, local, remote);
    expect(result.changes).toEqual({ toLocal: [], toRemote: [] });
  });

  it('describes each change in words, for the side that receives it', () => {
    const { base, local, remote, a, b, add } = setup();
    const ep = entry(remote, a.id).episodes;
    ep[0]!.watched = ep[1]!.watched = ep[2]!.watched = true;
    entry(remote, a.id).status = 'Completed';
    entry(remote, a.id).metadata.tags.push('Comedy');
    remote.progress[ep[2]!.id] = progress(a.id, ep[2]!.id, '2026-01-01', 408);
    entry(remote, a.id).episodes[2]!.watched = false;
    add(remote, 'Gamma');
    local.entries = local.entries.filter(e => e.id !== b.id);
    const { changes } = mergeCatalogs(base, local, remote);
    const alpha = changes.toLocal.find(c => c.key === a.id)!;
    expect(alpha.kind).toBe('changed');
    expect(alpha.details).toEqual([
      'Status: Ongoing → Completed',
      'Labels: +Comedy',
      'Episodes 1–2 watched',
      'Resume point: Episode 3 at 6:48',
    ]);
    expect(changes.toLocal.find(c => c.title === 'Gamma (S1)')!.kind).toBe(
      'added',
    );
    expect(changes.toRemote.find(c => c.key === b.id)!.kind).toBe('removed');
    // This device's own edits are not news to it.
    expect(changes.toLocal.some(c => c.key === b.id)).toBe(false);
  });

  it('never spreads a cover file missing on one device as a removal', () => {
    const { base, local, remote, a } = setup();
    for (const c of [base, local, remote]) {
      entry(c, a.id).cover = 'sha:' + 'a'.repeat(64);
    }
    // The phone lost the file: it sends no cover, but says why.
    entry(local, a.id).cover = null;
    fillMissingCovers(base, local, remote, [a.id], []);
    const { catalog, changes } = mergeCatalogs(base, local, remote);
    expect(entry(catalog, a.id).cover).toBe('sha:' + 'a'.repeat(64));
    expect(changes.toRemote).toEqual([]);
    // Removing a cover on purpose is not carried across either; a new one is.
    const gone = setup();
    for (const c of [gone.base, gone.local, gone.remote]) {
      entry(c, gone.a.id).cover = 'sha:' + 'b'.repeat(64);
    }
    entry(gone.local, gone.a.id).cover = null;
    const removed = mergeCatalogs(gone.base, gone.local, gone.remote);
    expect(entry(removed.catalog, gone.a.id).cover).toBe(
      'sha:' + 'b'.repeat(64),
    );
    expect(removed.changes.toRemote).toEqual([]);
    entry(gone.local, gone.a.id).cover = 'sha:' + 'c'.repeat(64);
    const changed = mergeCatalogs(gone.base, gone.local, gone.remote);
    expect(entry(changed.catalog, gone.a.id).cover).toBe(
      'sha:' + 'c'.repeat(64),
    );
    expect(changed.changes.toRemote[0]!.details).toEqual(['New cover']);
  });

  it('carries only title and episode deletions; anything else emptied stays', () => {
    const { base, local, remote, a, b } = setup();
    // Episode 3 of Alpha and all of Beta deleted on the phone.
    entry(remote, a.id).episodes.pop();
    remote.entries = remote.entries.filter(e => e.id !== b.id);
    // Everything else the phone emptied or dropped must survive.
    const mine = entry(remote, a.id);
    mine.link = '';
    mine.season = '';
    mine.metadata.tags = [];
    mine.episodes[0]!.title = '';
    remote.sections = [];
    // While the PC changes the link; a change still goes through.
    entry(local, a.id).season = 'Season 1';
    const { catalog, conflicts, changes } = mergeCatalogs(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(catalog.entries.map(e => e.id)).toEqual([a.id]);
    const merged = entry(catalog, a.id);
    expect(merged.episodes.map(e => e.number)).toEqual([1, 2]);
    expect(merged.link).toBe('https://example.com');
    expect(merged.season).toBe('Season 1');
    expect(merged.metadata.tags).toEqual(['Sample']);
    expect(merged.episodes[0]!.title).not.toBe('');
    expect(catalog.sections).toEqual(local.sections);
    expect(changes.toLocal.find(c => c.key === b.id)!.kind).toBe('removed');
    expect(() => validateCatalog(catalog)).not.toThrow();
  });
});
