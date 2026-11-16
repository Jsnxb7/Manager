import {
  emptyCatalog,
  emptyMetadata,
  emptySettings,
} from '../src/domain/catalog';
import { createEntry } from '../src/services/library';
import { scanAllRelations } from '../src/services/relations';
import { resetFolderLinks } from '../src/services/mediaFolders';
import {
  SavedPositions,
  clock,
  loadPositions,
  recordPosition,
  savePositions,
} from '../src/services/customPositions';
import { otherTitles, startYear } from '../src/integrations/JikanClient';
import { handleAppKey, pushKeyHandler } from '../src/app/keys';
import { previewRect } from '../src/platform/usePreview';
import { fileLabel } from '../src/screens/CustomPlayer';
import { memoryStorage } from './memoryStorage';

describe('app keys', () => {
  it('offers a key to the newest handler first and stops when one uses it', () => {
    const calls: string[] = [];
    const removeOld = pushKeyHandler(() => {
      calls.push('old');
      return true;
    });
    const removeNew = pushKeyHandler(key => {
      calls.push('new');
      return key === 'Escape';
    });
    expect(handleAppKey('Escape')).toBe(true);
    expect(calls).toEqual(['new']);
    expect(handleAppKey('F1')).toBe(true);
    expect(calls).toEqual(['new', 'new', 'old']);
    removeNew();
    removeOld();
    expect(handleAppKey('Escape')).toBe(false);
  });
});

describe('custom player positions', () => {
  it('keeps mid-file positions and forgets finished or barely started files', () => {
    const saved: SavedPositions = {};
    recordPosition(saved, 'a.mkv', 300, 1400);
    recordPosition(saved, 'b.mkv', 2, 1400);
    expect(Object.keys(saved)).toEqual(['a.mkv']);
    recordPosition(saved, 'a.mkv', 1300, 1400);
    expect(saved['a.mkv']).toBeUndefined();
    recordPosition(saved, 'c.mkv', 100, 1400);
    recordPosition(saved, 'c.mkv', 100, 1400, true);
    expect(saved['c.mkv']).toBeUndefined();
  });
  it('keeps only the newest 200 files', () => {
    const saved: SavedPositions = {};
    for (let i = 0; i < 205; i++) {
      recordPosition(
        saved,
        `f${i}`,
        60,
        1000,
        false,
        new Date(2026, 0, 1, 0, i),
      );
    }
    expect(Object.keys(saved)).toHaveLength(200);
    expect(saved.f0).toBeUndefined();
    expect(saved.f204).toBeDefined();
  });
  it('saves and loads, and ignores a damaged file', async () => {
    const s = memoryStorage();
    const saved: SavedPositions = {};
    recordPosition(saved, 'C:\\Videos\\a.mkv', 754, 1400);
    await savePositions(s.io, saved);
    expect((await loadPositions(s.io))['C:\\Videos\\a.mkv']?.position).toBe(
      754,
    );
    await s.io.writeText(
      `${s.io.privateRoot}/custom-player-positions.json`,
      '{',
    );
    expect(await loadPositions(s.io)).toEqual({});
  });
  it('formats resume times', () => {
    expect(clock(754)).toBe('12:34');
    expect(clock(3725)).toBe('1:02:05');
  });
});

describe('whole-library relations check', () => {
  const setup = () => {
    const c = emptyCatalog();
    const add = (title: string, season: string) =>
      createEntry(c, 'anime', {
        title,
        season,
        status: 'Completed',
        link: 'https://example.com',
        episodeCount: 1,
        metadata: { ...emptyMetadata(), tags: ['Sample'] },
        cover: null,
        external: null,
      });
    return { c, a: add('Example Show', 'S1'), b: add('Example Show', 'S2') };
  };
  it('links seasons across the library and reports how many titles joined', () => {
    const { c } = setup();
    c.relations = [];
    expect(scanAllRelations(c)).toBe(2);
    expect(scanAllRelations(c)).toBe(0);
  });
  it('keeps pairs the user separated apart', () => {
    const { c, a, b } = setup();
    c.relations = [];
    c.blockedPairs = [[a.id, b.id]];
    expect(scanAllRelations(c)).toBe(0);
  });
});

describe('search result details', () => {
  const base = { mal_id: 1, type: 'TV', status: '', episodes: 12, url: '' };
  it('shows other titles once and only when they differ', () => {
    expect(
      otherTitles({
        ...base,
        title: 'Yubisaki to Renren',
        title_english: 'A Sign of Affection',
        title_japanese: 'ゆびさきと恋々',
      }),
    ).toEqual(['A Sign of Affection', 'ゆびさきと恋々']);
    expect(
      otherTitles({ ...base, title: 'Working!!', title_english: 'working!!' }),
    ).toEqual([]);
  });
  it('finds the start year from any source field', () => {
    expect(startYear({ ...base, title: 'x', year: 2024 })).toBe(2024);
    expect(
      startYear({
        ...base,
        title: 'x',
        aired: { prop: { from: { year: 2010 } } },
      }),
    ).toBe(2010);
    expect(
      startYear({
        ...base,
        title: 'x',
        published: { prop: { from: { year: 2019 } } },
      }),
    ).toBe(2019);
    expect(startYear({ ...base, title: 'x' })).toBeNull();
  });
});

describe('folder links and previews', () => {
  it('reset forgets roots and relinked locations only', () => {
    const settings = emptySettings();
    settings.roots.anime = 'D:/Anime';
    settings.titleFolders['anime:1'] = 'D:/Anime/Show/S1';
    settings.episodeFiles['anime:1:episode:1'] = 'D:/x.mkv';
    settings.filters.anime = settings.filters.anime ?? ({} as never);
    resetFolderLinks(settings);
    expect(settings.roots).toEqual({});
    expect(settings.titleFolders).toEqual({});
    expect(settings.episodeFiles).toEqual({});
    expect('anime' in settings.filters).toBe(true);
  });
  it('places a preview beside the item and inside the window', () => {
    const window = { width: 1400, height: 900 };
    expect(
      previewRect({ x: 100, y: 400, width: 84, height: 120 }, window),
    ).toEqual({ x: 196, y: 370, width: 320, height: 180 });
    const right = previewRect(
      { x: 1250, y: 850, width: 150, height: 40 },
      window,
    );
    expect(right.x).toBe(1250 - 320 - 12);
    expect(right.y).toBe(900 - 180 - 12);
  });
});

describe('custom player file names', () => {
  it('shows only the file name, without folders, extension or underscores', () => {
    expect(
      fileLabel(
        'C:\\Users\\me\\Anime\\Show\\S1\\AnimePahe_Show_-_01_BD_1080p.mp4',
      ),
    ).toEqual({ title: 'AnimePahe Show - 01 BD 1080p', kind: 'MP4' });
    expect(fileLabel('content://media/external/video/My%20Clip.mkv')).toEqual({
      title: 'My Clip',
      kind: 'MKV',
    });
    expect(fileLabel('noextension')).toEqual({
      title: 'noextension',
      kind: '',
    });
  });
});
