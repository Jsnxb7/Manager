import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { CatalogRegistry } from '../src/repositories/CatalogRegistry';
import { createEntry } from '../src/services/library';
import { emptyMetadata } from '../src/domain/catalog';
import { exportCatalog, inspectPackageFile } from '../src/services/transfer';
import { UnpackedPackage } from '../src/platform/contracts';
import { memoryStorage } from './memoryStorage';

// Stands in for the Android unpacker: extracts covers into app storage and reports
// each file's checksum, so covers never reach JavaScript as bytes.
function nativeUnpacker(
  memory: ReturnType<typeof memoryStorage>,
  zip: Uint8Array,
) {
  return async (_uri: string, staging: string): Promise<UnpackedPackage> => {
    const files = unzipSync(zip);
    const listed: UnpackedPackage['files'] = [];
    for (const [name, bytes] of Object.entries(files)) {
      if (name.startsWith('artwork/')) {
        memory.files.set(`${staging}/${name}`, bytes);
      }
      if (name !== 'manifest.json') {
        listed.push({
          name,
          bytes: bytes.length,
          sha256: bytesToHex(sha256(bytes)),
        });
      }
    }
    return {
      manifest: strFromU8(files['manifest.json']!),
      catalog: strFromU8(files['data/catalog.json']!),
      files: listed,
    };
  };
}

describe('native catalog import', () => {
  it('imports unpacked covers by moving them, and rejects tampered files', async () => {
    const pc = memoryStorage('pc');
    const source = await new CatalogRegistry(pc.io).start();
    await source.repo.mutate(c => {
      createEntry(c, 'anime', {
        title: 'Synthetic Series',
        season: 'S1',
        status: 'Ongoing',
        link: 'https://example.com',
        episodeCount: 1,
        metadata: { ...emptyMetadata(), genres: ['Action'] },
        cover: 'artwork/cover.webp',
        external: null,
      });
    });
    pc.files.set('pc/artwork/cover.webp', strToU8('cover-bytes'));
    await exportCatalog(source.repo, pc.io);
    const zip = pc.getSaved();

    const phone = memoryStorage('phone');
    const io = {
      ...phone.io,
      unpackPackage: nativeUnpacker(phone, zip),
      moveOwned: async (from: string, to: string) => {
        phone.files.set(to, phone.files.get(from)!);
        phone.files.delete(from);
      },
    };
    const registry = new CatalogRegistry(io);
    const opened = await registry.start();
    const preview = await inspectPackageFile('picked.zip', opened.repo, io);
    expect(typeof Object.values(preview.artwork)[0]).toBe('string');
    const imported = await registry.accept(
      preview,
      opened.repo,
      opened.settings,
    );
    const cover = imported.catalog.entries[0]!.cover!;
    expect(strFromU8(phone.files.get(`phone/${cover}`)!)).toBe('cover-bytes');

    const tampered = {
      ...io,
      unpackPackage: async (uri: string, staging: string) => {
        const result = await nativeUnpacker(phone, zip)(uri, staging);
        result.files[0]!.sha256 = '0'.repeat(64);
        return result;
      },
    };
    await expect(
      inspectPackageFile('picked.zip', imported.repo, tampered),
    ).rejects.toThrow('Checksum mismatch');
  });
});
