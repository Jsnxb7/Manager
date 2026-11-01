import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { emptyMetadata, validateCatalog } from '../src/domain/catalog';
import { CatalogRegistry } from '../src/repositories/CatalogRegistry';
import { createEntry } from '../src/services/library';
import { addRelation } from '../src/services/relations';
import {
  exportCatalog,
  inspectPackage,
  inspectSavedSnapshot,
} from '../src/services/transfer';
import { MediaResolver } from '../src/services/media';
import { deleteLocalMedia } from '../src/services/mutations';
import { memoryStorage } from './memoryStorage';
describe('cross-device catalog transfer', () => {
  it('keeps the divergent pre-import snapshot after later saves and can inspect it for restoration', async () => {
    const memory = memoryStorage();
    const registry = new CatalogRegistry(memory.io);
    const opened = await registry.start();
    await opened.repo.mutate(c => {
      c.legacy.side = 'older';
    });
    await exportCatalog(opened.repo, memory.io);
    const oldExport = memory.getSaved();
    await opened.repo.mutate(c => {
      c.legacy.side = 'newer';
    });
    const preview = await inspectPackage(oldExport, opened.repo);
    expect(preview.divergent).toBe(true);
    const imported = await registry.accept(
      preview,
      opened.repo,
      opened.settings,
    );
    await imported.repo.mutate(c => {
      c.legacy.laterSave = true;
    });
    const archived = [...memory.files].find(
      ([name, bytes]) =>
        name.includes('/snapshots/') &&
        JSON.parse(strFromU8(bytes)).legacy.side === 'newer',
    );
    expect(archived).toBeDefined();
    const restored = await inspectSavedSnapshot(
      archived![0],
      imported.repo,
      memory.io,
    );
    expect(restored.catalog.legacy.side).toBe('newer');
  });
  it('round-trips all references and covers while retaining phone roots and separate catalogs', async () => {
    const pc = memoryStorage('pc'),
      phone = memoryStorage('phone');
    const pcRegistry = new CatalogRegistry(pc.io),
      phoneRegistry = new CatalogRegistry(phone.io);
    const first = await pcRegistry.start();
    const catalog = await first.repo.mutate(c => {
      const metadata = { ...emptyMetadata(), genres: ['Action'] };
      const draft = {
        title: 'Synthetic Series',
        season: 'S1',
        status: 'Ongoing' as const,
        link: 'https://example.com',
        episodeCount: 2,
        metadata,
        cover: 'artwork/cover.webp',
        external: null,
      };
      const a = createEntry(c, 'anime', draft),
        b = createEntry(c, 'anime', { ...draft, season: 'S2', cover: null });
      c.queue = [a.id, b.id];
      addRelation(c, a.id, b.id);
      const ep = a.episodes[0]!;
      c.progress[ep.id] = {
        entryId: a.id,
        episodeId: ep.id,
        currentTime: 40,
        duration: 100,
        updatedAt: '2026-11-01',
      };
      a.bookmarked = true;
    });
    pc.files.set('pc/artwork/cover.webp', strToU8('synthetic artwork bytes'));
    const settings = first.settings;
    settings.roots.anime = 'D:/Anime';
    await first.repo.saveSettings(settings);
    await exportCatalog(first.repo, pc.io);
    const bytes = pc.getSaved();
    const packed = unzipSync(bytes);
    expect(Object.keys(packed).sort()).toEqual([
      'artwork/cover.webp',
      'data/catalog.json',
      'manifest.json',
    ]);
    expect(JSON.stringify(packed)).not.toContain('D:/Anime');
    const second = await phoneRegistry.start();
    const local = second.settings;
    local.roots.anime = 'content://phone-selected-tree';
    await second.repo.saveSettings(local);
    const imported = await phoneRegistry.accept(
      await inspectPackage(bytes, second.repo),
      second.repo,
      local,
    );
    expect(imported.catalog.id).toBe(catalog.id);
    expect(imported.catalog.entries.map(e => e.id)).toEqual(
      catalog.entries.map(e => e.id),
    );
    expect(imported.catalog.queue).toEqual(catalog.queue);
    expect(imported.catalog.relations).toEqual(catalog.relations);
    expect(imported.catalog.progress).toEqual(catalog.progress);
    expect(imported.catalog.entries[0]?.bookmarked).toBe(true);
    expect(imported.settings.roots.anime).toBe('content://phone-selected-tree');
    expect(phoneRegistry.catalogs).toHaveLength(2);
    const importedCover = imported.catalog.entries[0]!.cover!;
    expect(phone.files.get('phone/' + importedCover)).toEqual(
      pc.files.get('pc/artwork/cover.webp'),
    );
    const reopened = await new CatalogRegistry(phone.io).start();
    expect(reopened.catalog.id).toBe(catalog.id);
    expect(reopened.settings.roots.anime).toBe('content://phone-selected-tree');
    validateCatalog(reopened.catalog);
  });
  it('rejects content changed without updating its checksum', async () => {
    const memory = memoryStorage();
    const opened = await new CatalogRegistry(memory.io).start();
    await exportCatalog(opened.repo, memory.io);
    const files = unzipSync(memory.getSaved());
    files['data/catalog.json'] = strToU8('{}');
    await expect(inspectPackage(zipSync(files), opened.repo)).rejects.toThrow(
      'Checksum mismatch',
    );
  });
  it('resolves absolute-numbered complete seasons with one shared directory scan', async () => {
    const memory = memoryStorage();
    const opened = await new CatalogRegistry(memory.io).start();
    const c = await opened.repo.mutate(d => {
      createEntry(d, 'anime', {
        title: 'Sample',
        season: 'S1',
        status: 'Ongoing',
        link: 'https://example.com',
        episodeCount: 2,
        metadata: { ...emptyMetadata(), tags: ['Sample'] },
        cover: null,
        external: null,
      });
    });
    const e = c.entries[0]!;
    memory.directories.add('media/' + e.relativeFolder);
    memory.files.set(`media/${e.relativeFolder}/EP.14.mkv`, new Uint8Array());
    memory.files.set(`media/${e.relativeFolder}/EP.15.mkv`, new Uint8Array());
    opened.settings.roots.anime = 'media';
    const listing = memory.io.list;
    let scans = 0;
    memory.io.list = async p => {
      scans++;
      return listing(p);
    };
    const found = await new MediaResolver(memory.io).check(e, opened.settings);
    expect(Object.values(found).every(v => v.state === 'available')).toBe(true);
    expect(scans).toBe(1);
  });
  it('requires a local root before intentional media deletion', async () => {
    const memory = memoryStorage();
    const opened = await new CatalogRegistry(memory.io).start();
    const c = await opened.repo.mutate(d => {
      createEntry(d, 'anime', {
        title: 'Sample',
        season: 'S1',
        status: 'Ongoing',
        link: 'https://example.com',
        episodeCount: 1,
        metadata: { ...emptyMetadata(), tags: ['Sample'] },
        cover: null,
        external: null,
      });
    });
    await expect(
      deleteLocalMedia(c.entries[0]!, opened.settings, memory.io),
    ).rejects.toThrow('Select the local');
    expect(memory.removed).toEqual([]);
    opened.settings.roots.anime = 'device-root';
    await deleteLocalMedia(c.entries[0]!, opened.settings, memory.io);
    expect(memory.removed).toEqual(['device-root/Sample/S1']);
  });
});
