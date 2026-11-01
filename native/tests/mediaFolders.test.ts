import {
  emptyCatalog,
  emptyMetadata,
  emptySettings,
} from '../src/domain/catalog';
import { createEntry } from '../src/services/library';
import {
  animeFolder,
  createEntryMediaFolder,
  createMissingMediaFolders,
  previewMediaFolders,
  securePathPart,
} from '../src/services/mediaFolders';
import {
  deleteEntry,
  deleteLocalMedia,
  resolvedDeleteTarget,
} from '../src/services/mutations';
import { memoryStorage } from './memoryStorage';

function setup() {
  const catalog = emptyCatalog();
  const entry = createEntry(catalog, 'anime', {
    title: 'Synthetic Show',
    season: 'S1',
    status: 'Ongoing',
    link: 'https://example.com',
    episodeCount: 1,
    metadata: { ...emptyMetadata(), tags: ['Test'] },
    cover: null,
    external: null,
  });
  const settings = emptySettings();
  settings.roots.anime = 'media';
  return { ...memoryStorage(), catalog, entry, settings };
}

describe('media folder creation', () => {
  it.each([
    [' . Foo: Bar / Baz. ', 'Foo- Bar - Baz'],
    ['NUL', 'NUL_'],
    ['a\u0000b', 'a-b'],
    [' a\t b\n c ', 'a b c'],
    ['..', ''],
  ])('sanitizes %s like the setup script', (value, expected) => {
    expect(securePathPart(value)).toBe(expected);
  });
  it('previews, deduplicates case-insensitively and creates nested folders idempotently', async () => {
    const s = setup();
    const entries = [
      s.entry,
      { ...s.entry, title: s.entry.title.toUpperCase() },
    ];
    const preview = await previewMediaFolders(entries, 'media', s.io);
    expect(preview.missing).toHaveLength(1);
    expect(await createMissingMediaFolders(preview, s.io)).toBe(1);
    expect(
      (await previewMediaFolders(entries, 'media', s.io)).existing,
    ).toHaveLength(1);
    await s.io.createMediaFolder('media', animeFolder(s.entry));
    expect(s.directories.has('media/Synthetic Show/S1')).toBe(true);
  });
  it('reports no root and preserves the record when folder creation fails', async () => {
    const s = setup();
    expect(
      await createEntryMediaFolder(s.entry, emptySettings(), s.io),
    ).toContain('No media folder');
    s.io.createMediaFolder = async () => {
      throw new Error('denied');
    };
    await expect(
      createEntryMediaFolder(s.entry, s.settings, s.io),
    ).rejects.toThrow('denied');
    expect(s.catalog.entries).toHaveLength(1);
  });
  it('rejects traversal in the synthetic adapter', async () => {
    const s = setup();
    await expect(
      s.io.createMediaFolder('media', '../outside'),
    ).rejects.toThrow();
    await expect(s.io.createMediaFolder('media', '/outside')).rejects.toThrow();
  });
});

describe('recoverable deletion', () => {
  it('proves SAF ancestry even when the override has its own tree URI', async () => {
    const s = setup();
    const root = 'content://synthetic/tree/root';
    const child = 'content://synthetic/tree/root/document/opaque-season';
    s.settings.roots.anime = root;
    s.settings.titleFolders[s.entry.id] =
      'content://synthetic/tree/opaque-season';
    s.io.list = async uri =>
      uri === root
        ? [{ name: 'Season', uri: child, directory: true, size: 0 }]
        : [];
    expect(await resolvedDeleteTarget(s.entry, s.settings, s.io)).toEqual({
      root,
      uri: child,
      relativePath: 'Season',
    });
  });
  it('resolves relinked descendants but never a root, sibling or outside folder', async () => {
    const s = setup();
    s.directories.add('media/custom');
    s.settings.titleFolders[s.entry.id] = 'media/custom';
    expect(await resolvedDeleteTarget(s.entry, s.settings, s.io)).toEqual({
      root: 'media',
      relativePath: 'custom',
      uri: 'media/custom',
    });
    for (const folder of ['media', 'media-other/custom', 'elsewhere/custom']) {
      s.settings.titleFolders[s.entry.id] = folder;
      expect(await resolvedDeleteTarget(s.entry, s.settings, s.io)).toBeNull();
    }
  });
  it('allows record-only deletion without a root and removes an owned cover', async () => {
    const s = setup();
    s.entry.cover = 'artwork/test.webp';
    s.files.set('app/artwork/test.webp', new Uint8Array([1]));
    await deleteEntry(s.entry, emptySettings(), s.io, async change => {
      change(s.catalog);
    });
    expect(s.catalog.entries).toHaveLength(0);
    expect(s.removed).toEqual([]);
    expect(s.files.has('app/artwork/test.webp')).toBe(false);
  });
  it('does not touch videos when the pending catalog write fails', async () => {
    const s = setup();
    s.directories.add('media/Synthetic Show/S1');
    await expect(
      deleteEntry(s.entry, s.settings, s.io, async () => {
        throw new Error('disk full');
      }),
    ).rejects.toThrow('disk full');
    expect(s.removed).toEqual([]);
  });
  it('keeps a retryable pending record if media deletion fails', async () => {
    const s = setup();
    s.directories.add('media/Synthetic Show/S1');
    s.io.deleteMediaFolder = async () => {
      throw new Error('provider failed');
    };
    await expect(
      deleteEntry(s.entry, s.settings, s.io, async change => {
        change(s.catalog);
      }),
    ).rejects.toThrow('provider failed');
    expect(s.catalog.entries[0]?.legacy.pendingDeletion).toBeDefined();
  });
  it('retains the pending catalog marker if final removal fails', async () => {
    const s = setup();
    s.directories.add('media/Synthetic Show/S1');
    let writes = 0;
    await expect(
      deleteEntry(s.entry, s.settings, s.io, async change => {
        if (++writes === 2) {
          throw new Error('disk full');
        }
        change(s.catalog);
      }),
    ).rejects.toThrow('disk full');
    expect(s.catalog.entries[0]?.legacy.pendingDeletion).toBeDefined();
    expect(s.removed).toEqual(['media/Synthetic Show/S1']);
  });
  it('compatibility deletion preserves videos if its recovery write fails', async () => {
    const s = setup();
    s.directories.add('media/Synthetic Show/S1');
    s.io.writeText = async () => {
      throw new Error('disk full');
    };
    await expect(deleteLocalMedia(s.entry, s.settings, s.io)).rejects.toThrow(
      'disk full',
    );
    expect(s.removed).toEqual([]);
  });
  it('never removes external artwork', async () => {
    const s = setup();
    s.entry.cover = '../private.webp';
    const remove = jest.spyOn(s.io, 'removeOwned');
    await deleteEntry(s.entry, emptySettings(), s.io, async change => {
      change(s.catalog);
    });
    expect(remove).not.toHaveBeenCalled();
  });
});
