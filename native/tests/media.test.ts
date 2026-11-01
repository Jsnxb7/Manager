import {
  emptyCatalog,
  emptyMetadata,
  emptySettings,
  Entry,
  Episode,
} from '../src/domain/catalog';
import { createEntry } from '../src/services/library';
import { episodeNumber, MediaResolver } from '../src/services/media';
import { memoryStorage } from './memoryStorage';

function setup(count = 2) {
  const storage = memoryStorage();
  const entry = createEntry(emptyCatalog(), 'anime', {
    title: 'Synthetic Show',
    season: 'S1',
    status: 'Ongoing',
    link: 'https://example.com',
    episodeCount: count,
    metadata: { ...emptyMetadata(), tags: ['Synthetic'] },
    cover: null,
    external: null,
  }) as Entry & { episodes: [Episode, Episode, ...Episode[]] };
  const settings = emptySettings();
  settings.titleFolders[entry.id] = 'media/season';
  const add = (name: string) =>
    storage.files.set(`media/season/${name}`, new Uint8Array());
  const check = () => new MediaResolver(storage.io).check(entry, settings);
  return { ...storage, entry, settings, add, check };
}

describe('episode filename parsing', () => {
  it.each([
    ['AnimePahe_86_-_01v2_1080p_SubsPlease.mp4', 1],
    ['Mob Psycho 100 - 03.mkv', 3],
    ['Synthetic 86 E01 x264 10bit.mkv', 1],
    ['Synthetic 86 EP01_1080p.webm', 1],
    ['Synthetic 86 Episode 1 v2.avi', 1],
    ['Synthetic 86 S02E03.mov', 3],
    ['Synthetic 86 03 1080p x264 10bit.m4v', 3],
    ['01v2.mp4', 1],
    ['01.MKV', 1],
    ['Synthetic_1080p_x264_10bit_v2.mkv', null],
    ['Synthetic 1080p x264 10bit v2.mp4', null],
    ['01.ogg', null],
    ['01.txt', null],
    ['01.mp4.bak', null],
  ])('%s maps to %s', (name, number) => {
    expect(episodeNumber(name)).toBe(number);
  });
});

describe('media availability', () => {
  it('uses release episode numbers instead of numeric titles and shares one scan', async () => {
    const s = setup();
    s.add('AnimePahe_86_-_01v2_1080p_SubsPlease.mp4');
    s.add('Mob Psycho 100 - 02.mkv');
    const list = jest.spyOn(s.io, 'list');
    const result = await s.check();
    expect(result[s.entry.episodes[0].id]).toEqual({
      state: 'available',
      uri: 'media/season/AnimePahe_86_-_01v2_1080p_SubsPlease.mp4',
    });
    expect(result[s.entry.episodes[1].id]).toEqual({
      state: 'available',
      uri: 'media/season/Mob Psycho 100 - 02.mkv',
    });
    expect(list).toHaveBeenCalledTimes(1);
  });
  it('reports duplicate claims even when the expected direct file exists', async () => {
    const s = setup();
    s.add('1.mp4');
    s.add('Synthetic - 01v2.mkv');
    const value = (await s.check())[s.entry.episodes[0].id];
    expect(value?.state).toBe('ambiguous');
    expect(value).toMatchObject({
      message: expect.stringMatching(/Locate.*move duplicate/),
    });
  });
  it('never assigns duplicate or absolute numbered files by ordinal', async () => {
    const s = setup();
    s.add('Synthetic - 03.mkv');
    s.add('Synthetic - 03v2.mp4');
    expect(
      Object.values(await s.check()).every(v => v.state === 'missing'),
    ).toBe(true);
    s.entry.episodes[0].number = 3;
    expect((await s.check())[s.entry.episodes[0].id]?.state).toBe('ambiguous');
    s.files.delete('media/season/Synthetic - 03v2.mp4');
    s.add('Synthetic - 04.mp4');
    s.entry.episodes[0].number = 1;
    expect(
      Object.values(await s.check()).every(v => v.state === 'missing'),
    ).toBe(true);
  });
  it('retains sorted ordinal fallback only for unnumbered videos with matching counts', async () => {
    const s = setup();
    s.add('Beta.mkv');
    s.add('Alpha.mp4');
    s.add('notes.txt');
    s.add('Audio.ogg');
    s.directories.add('media/season/Bonus.mkv');
    const result = await s.check();
    expect(result[s.entry.episodes[0].id]).toEqual({
      state: 'available',
      uri: 'media/season/Alpha.mp4',
    });
    expect(result[s.entry.episodes[1].id]).toEqual({
      state: 'available',
      uri: 'media/season/Beta.mkv',
    });
    s.add('Gamma.webm');
    expect(
      Object.values(await s.check()).every(v => v.state === 'missing'),
    ).toBe(true);
  });
  it('rejects directories and nonvideos at direct and explicit file paths', async () => {
    const s = setup(1);
    s.directories.add('media/season/1.mp4');
    s.settings.episodeFiles[s.entry.episodes[0].id] = 'media/season/1.mp4';
    expect((await s.check())[s.entry.episodes[0].id]?.state).toBe('missing');
    s.add('notes.txt');
    s.entry.episodes[0].relativeFile = 'notes.txt';
    s.settings.episodeFiles[s.entry.episodes[0].id] = 'media/season/notes.txt';
    expect((await s.check())[s.entry.episodes[0].id]?.state).toBe('missing');
  });
  it('allows an explicit video selection to resolve duplicates without a title folder', async () => {
    const s = setup(1);
    s.add('1.mp4');
    s.add('Synthetic - 01.mkv');
    s.settings.episodeFiles[s.entry.episodes[0].id] = 'media/season/1.mp4';
    s.settings.titleFolders = {};
    expect((await s.check())[s.entry.episodes[0].id]).toEqual({
      state: 'available',
      uri: 'media/season/1.mp4',
    });
  });
  it('validates nested relative files through directory listings', async () => {
    const s = setup(1);
    s.directories.add('media/season/extras');
    s.add('extras/feature.mkv');
    s.entry.episodes[0].relativeFile = 'extras/feature.mkv';
    expect((await s.check())[s.entry.episodes[0].id]).toEqual({
      state: 'available',
      uri: 'media/season/extras/feature.mkv',
    });
  });
  it('validates opaque provider URIs using listing metadata', async () => {
    const s = setup(1);
    const uri = 'content://synthetic/document/opaque';
    s.settings.episodeFiles[s.entry.episodes[0].id] = uri;
    s.io.exists = async () => true;
    s.io.list = async () => [{ name: '1.mp4', uri, directory: true, size: 0 }];
    expect((await s.check())[s.entry.episodes[0].id]?.state).toBe('missing');
    s.io.list = async () => [{ name: '1.mp4', uri, directory: false, size: 1 }];
    expect((await s.check())[s.entry.episodes[0].id]).toEqual({
      state: 'available',
      uri,
    });
  });
});
