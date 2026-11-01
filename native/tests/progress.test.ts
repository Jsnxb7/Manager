import { emptyCatalog, emptyMetadata } from '../src/domain/catalog';
import { createEntry } from '../src/services/library';
import {
  CompletionGuard,
  saveProgress,
  subtitleToVtt,
} from '../src/services/progress';
describe('playback boundaries', () => {
  it('marks completion at 90 percent without advancing before actual end', () => {
    const c = emptyCatalog();
    const e = createEntry(c, 'anime', {
      title: 'Sample',
      season: 'S1',
      status: 'Ongoing',
      link: 'https://example.com',
      episodeCount: 1,
      metadata: { ...emptyMetadata(), tags: ['Sample'] },
      cover: null,
      external: null,
    });
    const ep = e.episodes[0]!;
    saveProgress(c, e.id, ep.id, 50, 100);
    expect(c.progress[ep.id]?.currentTime).toBe(50);
    saveProgress(c, e.id, ep.id, 90, 100);
    expect(e.watched).toBe(true);
    expect(c.progress[ep.id]).toBeUndefined();
    const guard = new CompletionGuard();
    expect(guard.shouldAdvance(false)).toBe(false);
    expect(guard.shouldAdvance(true)).toBe(true);
    expect(guard.shouldAdvance(true)).toBe(false);
  });
  it('converts SRT timestamps and retains existing VTT', () => {
    expect(subtitleToVtt('1\n00:00:01,000 --> 00:00:02,000\nHello')).toContain(
      '00:00:01.000 --> 00:00:02.000',
    );
    expect(subtitleToVtt('WEBVTT\n\n')).toBe('WEBVTT\n\n');
  });
});
