import { FileEntry } from '../src/platform/contracts';
import {
  isSpecialTitle,
  matchFolder,
  parseVideoName,
} from '../src/services/episodeMatch';

const file = (name: string): FileEntry => ({
  name,
  uri: `media/${name}`,
  directory: false,
  size: 1,
});
const entry = (count: number, season = 'Season 1', title = 'Show') => ({
  title,
  season,
  episodes: Array.from({ length: count }, (_, i) => ({
    id: `ep${i + 1}`,
    number: i + 1,
    title: '',
    watched: false,
    relativeFile: `${i + 1}.mp4`,
    legacy: {},
  })),
});
const names = (r: ReturnType<typeof matchFolder>) =>
  Object.fromEntries(
    Object.entries(r.episodes).map(([id, m]) => [
      id,
      m.state === 'matched' ? m.file.name : m.state,
    ]),
  );

describe('video name parsing', () => {
  it.each([
    ['[Group] Show - 05 [1080p] [ABCDEF12].mkv', 5],
    ['Show (2019) - 03.mkv', 3],
    ['Show 2019 03.mkv', 3],
    ['Show 2019.mkv', 2019],
    ['Show [07][720p].mp4', 7],
    ['Show S02E04 [1A2B3C4D].mkv', 4],
    ['86 - 02.mkv', 2],
  ])('%s is episode %s', (name, number) => {
    expect(parseVideoName(name)?.number).toBe(number);
  });
  it('reads version, group and resolution', () => {
    expect(parseVideoName('[Subs] Show - 03v2 (1080p).mkv')).toMatchObject({
      number: 3,
      version: 2,
      group: 'Subs',
      resolution: '1080p',
      kind: 'episode',
    });
  });
  it.each([
    'Show - NCOP 01.mkv',
    'Show NCED1.mkv',
    'Show - OP2.mkv',
    'Show - Preview 03.mkv',
    'Show PV 01.mkv',
    'Show Trailer.mkv',
    'Show - Recap 01.mkv',
  ])('%s is an extra', name => {
    expect(parseVideoName(name)?.kind).toBe('extra');
  });
  it('treats OVA files as specials', () => {
    expect(parseVideoName('Show - OVA 01.mkv')?.kind).toBe('special');
    expect(isSpecialTitle({ title: 'Show OVA', season: '' })).toBe(true);
    expect(isSpecialTitle({ title: 'Show', season: 'Season 2' })).toBe(false);
  });
});

describe('folder matching', () => {
  it('ignores extras that claim an episode number', () => {
    const r = matchFolder(entry(2), [
      file('Show - 01.mkv'),
      file('Show - NCOP 01.mkv'),
      file('Show - 02.mkv'),
    ]);
    expect(names(r)).toEqual({ ep1: 'Show - 01.mkv', ep2: 'Show - 02.mkv' });
    expect(r.extras.map(f => f.name)).toEqual(['Show - NCOP 01.mkv']);
  });
  it('counts OVA files only for an OVA title', () => {
    const files = [file('Show - OVA 01.mkv')];
    expect(names(matchFolder(entry(1), files))).toEqual({ ep1: 'none' });
    expect(names(matchFolder(entry(1, '', 'Show OVA'), files))).toEqual({
      ep1: 'Show - OVA 01.mkv',
    });
  });
  it('prefers the majority release group, then resolution, for duplicates', () => {
    const r = matchFolder(entry(3), [
      file('[A] Show - 01 [1080p].mkv'),
      file('[A] Show - 02 [1080p].mkv'),
      file('[B] Show - 02 [1080p].mkv'),
      file('[A] Show - 03 [1080p].mkv'),
      file('[A] Show - 03 [720p].mkv'),
    ]);
    expect(names(r)).toEqual({
      ep1: '[A] Show - 01 [1080p].mkv',
      ep2: '[A] Show - 02 [1080p].mkv',
      ep3: '[A] Show - 03 [1080p].mkv',
    });
    const ep2 = r.episodes.ep2;
    expect(ep2?.state === 'matched' && ep2.reason).toMatch(/release group/);
    const ep3 = r.episodes.ep3;
    expect(ep3?.state === 'matched' && ep3.reason).toMatch(/resolution/);
  });
  it('keeps Locate links ahead of everything', () => {
    const linked = file('Odd name.mkv');
    const r = matchFolder(entry(1), [linked, file('Show - 01v3.mkv')], {
      ep1: { file: linked, reason: 'Linked with Locate' },
    });
    expect(r.episodes.ep1).toMatchObject({ reason: 'Linked with Locate' });
  });
  it('shifts a later season numbered from 13', () => {
    const r = matchFolder(
      entry(12, 'Season 2'),
      Array.from({ length: 12 }, (_, i) => file(`Show - ${i + 13}.mkv`)),
    );
    expect(r.offset).toBe(12);
    expect(names(r).ep1).toBe('Show - 13.mkv');
    expect(names(r).ep12).toBe('Show - 24.mkv');
    expect(r.episodes.ep1).toMatchObject({
      reason: 'Numbered 13 in this folder',
    });
  });
  it('shifts a partly downloaded later season', () => {
    const r = matchFolder(entry(12), [
      file('Show - 13.mkv'),
      file('Show - 14.mkv'),
      file('Show - 15.mkv'),
    ]);
    expect(r.offset).toBe(12);
    expect(names(r).ep3).toBe('Show - 15.mkv');
    expect(names(r).ep4).toBe('none');
  });
  it('does not shift when the plain numbers match', () => {
    const r = matchFolder(entry(3), [
      file('Show - 01.mkv'),
      file('Show - 02.mkv'),
      file('Show - 05.mkv'),
    ]);
    expect(r.offset).toBe(0);
    expect(r.newEpisodes.map(n => n.number)).toEqual([5]);
  });
  it('lists files beyond the known episodes as new, after the shift', () => {
    const r = matchFolder(
      entry(2, 'Season 2'),
      [13, 14, 15, 16].map(n => file(`Show - ${n}.mkv`)),
    );
    expect(r.newEpisodes.map(n => [n.number, n.file.name])).toEqual([
      [3, 'Show - 15.mkv'],
      [4, 'Show - 16.mkv'],
    ]);
  });
  it('shifts a later season with no episodes yet from its season number', () => {
    const r = matchFolder(entry(0, 'Season 2'), [
      file('Show - 13.mkv'),
      file('Show - 14.mkv'),
    ]);
    expect(r.newEpisodes.map(n => n.number)).toEqual([1, 2]);
    const first = matchFolder(entry(0, 'Season 1'), [file('Show - 01.mkv')]);
    expect(first.newEpisodes.map(n => n.number)).toEqual([1]);
  });
});
