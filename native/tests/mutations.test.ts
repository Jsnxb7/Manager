import {
  emptyCatalog,
  emptyMetadata,
  validateCatalog,
} from '../src/domain/catalog';
import { createEntry } from '../src/services/library';
import {
  addEpisode,
  removeEpisode,
  setWatched,
} from '../src/services/mutations';
function setup() {
  const c = emptyCatalog();
  const e = createEntry(c, 'anime', {
    title: 'Sample',
    season: 'S1',
    status: 'Ongoing',
    link: 'https://example.com',
    episodeCount: 3,
    metadata: { ...emptyMetadata(), tags: ['Sample'] },
    cover: null,
    external: null,
  });
  return { c, e };
}
describe('watched and episode identity', () => {
  it('whole-title actions synchronize episode state and clear continuation', () => {
    const { c, e } = setup();
    const ep = e.episodes[0]!;
    c.progress[ep.id] = {
      entryId: e.id,
      episodeId: ep.id,
      currentTime: 30,
      duration: 100,
      updatedAt: 'now',
    };
    setWatched(c, e.id, true);
    expect(e.episodes.every(v => v.watched)).toBe(true);
    expect(c.progress).toEqual({});
    setWatched(c, e.id, false, e.episodes[1]!.id);
    expect(e.watched).toBe(false);
    validateCatalog(c);
  });
  it('deletion preserves surviving identities, numbers, filenames and progress', () => {
    const { c, e } = setup();
    const last = e.episodes[2]!;
    const before = { ...last };
    c.progress[last.id] = {
      entryId: e.id,
      episodeId: last.id,
      currentTime: 25,
      duration: 100,
      updatedAt: 'now',
    };
    removeEpisode(c, e.id, e.episodes[1]!.id);
    expect(e.episodes[1]).toEqual(before);
    expect(c.progress[last.id]?.currentTime).toBe(25);
    addEpisode(c, e.id, 'Extra');
    expect(e.episodes[2]?.number).toBe(4);
    validateCatalog(c);
  });
});
