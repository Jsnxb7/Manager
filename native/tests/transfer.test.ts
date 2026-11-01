import { strToU8, zipSync } from 'fflate';
import { inspectPackage } from '../src/services/transfer';
import { JsonRepository } from '../src/repositories/JsonRepository';
import { episodeNumber } from '../src/services/media';
describe('data-only transfer boundaries', () => {
  const unused = {} as JsonRepository;
  it('rejects video payloads before accepting a manifest', async () => {
    await expect(
      inspectPackage(zipSync({ 'video.mp4': strToU8('media') }), unused),
    ).rejects.toThrow('disallowed');
  });
  it('rejects traversal entries', async () => {
    await expect(
      inspectPackage(zipSync({ '../escape.json': strToU8('{}') }), unused),
    ).rejects.toThrow('relative');
  });
  it('extracts full episode numbers', () => {
    expect(episodeNumber('Show EP.12.mkv')).toBe(12);
    expect(episodeNumber('001.mp4')).toBe(1);
    expect(episodeNumber('cover.webp')).toBeNull();
  });
});
