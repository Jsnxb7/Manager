import {
  emptyCatalog,
  emptyMetadata,
  validateCatalog,
} from '../src/domain/catalog';
import { createEntry } from '../src/services/library';
import {
  addRelation,
  removeRelation,
  reorderRelation,
  scanRelations,
} from '../src/services/relations';
import {
  clearWatchedQueue,
  queueTarget,
  resolveTarget,
} from '../src/services/playback';
import { setWatched } from '../src/services/mutations';
function setup() {
  const c = emptyCatalog();
  const add = (title: string, season: string) =>
    createEntry(c, 'anime', {
      title,
      season,
      status: 'Ongoing',
      link: 'https://example.com',
      episodeCount: 2,
      metadata: { ...emptyMetadata(), tags: ['Sample'] },
      cover: null,
      external: null,
    });
  return {
    c,
    a: add('Example Show', 'S1'),
    b: add('Example Show', 'S2'),
    q: add('Other Title', 'S1'),
  };
}
describe('relations and title queue', () => {
  it('uses episode then relation then queue priority and preserves the anchor', () => {
    const { c, a, b, q } = setup();
    addRelation(c, a.id, b.id);
    c.queue = [a.id, q.id];
    const ep = resolveTarget(c, a.id, a.episodes[0]!.id, 1);
    expect(ep?.episodeId).toBe(a.episodes[1]!.id);
    const relation = resolveTarget(c, a.id, a.episodes[1]!.id, 1);
    expect(relation?.entryId).toBe(b.id);
    expect(relation?.queueAnchor).toBe(a.id);
    expect(
      resolveTarget(c, b.id, b.episodes[1]!.id, 1, relation!.queueAnchor)
        ?.entryId,
    ).toBe(q.id);
    expect(resolveTarget(c, b.id, b.episodes[0]!.id, -1, a.id)?.episodeId).toBe(
      a.episodes[1]!.id,
    );
  });
  it('uses saved resume for direct queue play and continuation', () => {
    const { c, a, q } = setup();
    c.queue = [a.id, q.id];
    const ep = q.episodes[1]!;
    c.progress[ep.id] = {
      entryId: q.id,
      episodeId: ep.id,
      currentTime: 30,
      duration: 100,
      updatedAt: '2026-11-01',
    };
    expect(queueTarget(c, q.id)?.episodeId).toBe(ep.id);
    expect(resolveTarget(c, a.id, a.episodes[1]!.id, 1)?.episodeId).toBe(ep.id);
  });
  it('retains blocked removals across scans and clears blocks on manual add', () => {
    const { c, a, b } = setup();
    scanRelations(c);
    removeRelation(c, a.id, b.id);
    scanRelations(c);
    expect(c.relations).toHaveLength(0);
    addRelation(c, a.id, b.id);
    expect(c.blockedPairs).toHaveLength(0);
    reorderRelation(c, a.id, [b.id, a.id]);
    expect(c.relations[0]?.entryIds).toEqual([b.id, a.id]);
    validateCatalog(c);
  });
  it('clear watched follows whole-title completion, not episode one', () => {
    const { c, a, q } = setup();
    c.queue = [a.id, q.id];
    setWatched(c, a.id, true, a.episodes[0]!.id);
    clearWatchedQueue(c);
    expect(c.queue).toContain(a.id);
    setWatched(c, a.id, true);
    clearWatchedQueue(c);
    expect(c.queue).toEqual([q.id]);
  });
});
