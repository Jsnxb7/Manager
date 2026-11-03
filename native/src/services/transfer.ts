import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  Catalog,
  cloneCatalog,
  newId,
  validateCatalog,
} from '../domain/catalog';
import { StorageAdapter, UnpackedPackage } from '../platform/contracts';
import { JsonRepository } from '../repositories/JsonRepository';
import {
  LegacyFiles,
  migrateLegacy,
  safeRelative,
} from '../repositories/legacyImport';

const MAX_PACKAGE = 768 * 1024 * 1024;
const MAX_FILE = 32 * 1024 * 1024;
const hash = (bytes: Uint8Array): string => bytesToHex(sha256(bytes));
const artworkName = (name: string): boolean =>
  /^artwork\/[a-zA-Z0-9_-]+\.(webp|png|jpe?g|gif|avif)$/i.test(name);
type Manifest = {
  format: 'anime-manager-catalog';
  schemaVersion: 2;
  catalogId: string;
  revision: string;
  exportedAt: string;
  files: Record<string, { bytes: number; sha256: string }>;
};
export type ImportPreview = {
  catalog: Catalog;
  /** Cover bytes, or the path of a cover already unpacked into app storage. */
  artwork: Record<string, Uint8Array | string>;
  warnings: string[];
  expectedRevision: string;
  divergent: boolean;
  differentCatalog: boolean;
};

export async function exportCatalog(
  repo: JsonRepository,
  io: StorageAdapter,
): Promise<string | null> {
  const catalog = await repo.snapshot();
  const fileName = `anime-catalog-${new Date().toISOString().slice(0, 10)}.zip`;
  if (io.pickSaveTarget && io.writePackage) {
    const covers = [
      ...new Set(catalog.entries.flatMap(e => (e.cover ? [e.cover] : []))),
    ];
    if (!covers.every(artworkName)) {
      throw new Error('Invalid artwork reference; videos cannot be exported.');
    }
    const target = await io.pickSaveTarget(fileName);
    if (!target) {
      return null;
    }
    return io.writePackage(
      target,
      JSON.stringify(catalog),
      {
        format: 'anime-manager-catalog',
        schemaVersion: 2,
        catalogId: catalog.id,
        revision: catalog.revision,
        exportedAt: new Date().toISOString(),
      },
      covers.map(name => ({ name, path: `${io.privateRoot}/${name}` })),
    );
  }
  const files: Record<string, Uint8Array> = {
    'data/catalog.json': strToU8(JSON.stringify(catalog)),
  };
  for (const entry of catalog.entries) {
    if (!entry.cover) {
      continue;
    }
    if (!artworkName(entry.cover)) {
      throw new Error('Invalid artwork reference; videos cannot be exported.');
    }
    if (!files[entry.cover]) {
      files[entry.cover] = await io.readBytes(
        `${io.privateRoot}/${entry.cover}`,
      );
    }
  }
  let total = 0;
  const manifest: Manifest = {
    format: 'anime-manager-catalog',
    schemaVersion: 2,
    catalogId: catalog.id,
    revision: catalog.revision,
    exportedAt: new Date().toISOString(),
    files: {},
  };
  for (const [name, bytes] of Object.entries(files)) {
    total += bytes.length;
    if (bytes.length > MAX_FILE || total > MAX_PACKAGE) {
      throw new Error(
        'Catalog package is too large. Reduce artwork sizes before export.',
      );
    }
    manifest.files[name] = { bytes: bytes.length, sha256: hash(bytes) };
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  return io.saveFile(
    fileName,
    // Artwork is already compressed; storing it as-is skips the slowest step.
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, bytes]) => [
          name,
          [bytes, { level: artworkName(name) ? 0 : 6 }],
        ]),
      ),
    ),
  );
}

/** Opens a catalog ZIP, natively where the host can, so large packages stay off the JS heap. */
export async function inspectPackageFile(
  uri: string,
  repo: JsonRepository,
  io: StorageAdapter,
): Promise<ImportPreview> {
  if (!io.unpackPackage || !io.moveOwned) {
    return inspectPackage(await io.readBytes(uri), repo);
  }
  const staging = `${io.privateRoot}/import-staging`;
  let unpacked: UnpackedPackage;
  try {
    unpacked = await io.unpackPackage(uri, staging);
  } catch (error) {
    // Older exports compressed every file; those still open the original way.
    if (String(error).includes('compressed package')) {
      return inspectPackage(await io.readBytes(uri), repo);
    }
    throw error;
  }
  return previewUnpacked(unpacked, staging, repo);
}

async function previewUnpacked(
  unpacked: UnpackedPackage,
  staging: string,
  repo: JsonRepository,
): Promise<ImportPreview> {
  const manifest = JSON.parse(unpacked.manifest) as Manifest;
  if (
    manifest.format !== 'anime-manager-catalog' ||
    manifest.schemaVersion !== 2 ||
    !manifest.files ||
    typeof manifest.files !== 'object'
  ) {
    throw new Error('Unsupported catalog package');
  }
  const files = new Map(unpacked.files.map(file => [file.name, file]));
  for (const [name, value] of Object.entries(manifest.files)) {
    const file = files.get(name);
    if (!file || file.bytes !== value.bytes || file.sha256 !== value.sha256) {
      throw new Error(`Checksum mismatch: ${name}`);
    }
  }
  for (const name of files.keys()) {
    if (!manifest.files[name]) {
      throw new Error('Unlisted package file');
    }
  }
  const catalog = validateCatalog(JSON.parse(unpacked.catalog));
  if (
    catalog.id !== manifest.catalogId ||
    catalog.revision !== manifest.revision
  ) {
    throw new Error('Manifest identity does not match catalog');
  }
  const artwork: Record<string, string> = {};
  for (const entry of catalog.entries) {
    if (entry.cover) {
      if (!artworkName(entry.cover) || !files.has(entry.cover)) {
        throw new Error(`Missing artwork for ${entry.title}`);
      }
      artwork[entry.cover] = `${staging}/${entry.cover}`;
    }
  }
  const current = await repo.snapshot();
  return {
    catalog,
    artwork,
    warnings: [],
    expectedRevision: current.revision,
    differentCatalog: current.id !== catalog.id,
    divergent:
      current.id === catalog.id &&
      current.revision !== catalog.revision &&
      catalog.parentRevision !== current.revision,
  };
}

export async function inspectPackage(
  bytes: Uint8Array,
  repo: JsonRepository,
): Promise<ImportPreview> {
  if (bytes.length > MAX_PACKAGE) {
    throw new Error('Package exceeds 128 MiB limit');
  }
  let expanded = 0,
    count = 0;
  const files = unzipSync(bytes, {
    filter: file => {
      safeRelative(file.name);
      count++;
      expanded += file.originalSize;
      if (
        count > 10000 ||
        file.originalSize > MAX_FILE ||
        expanded > MAX_PACKAGE ||
        !(
          file.name === 'manifest.json' ||
          file.name === 'data/catalog.json' ||
          artworkName(file.name)
        )
      ) {
        throw new Error(
          'Package contains disallowed files or exceeds extraction limits.',
        );
      }
      return true;
    },
  });
  const rawManifest = files['manifest.json'];
  const rawCatalog = files['data/catalog.json'];
  if (!rawManifest || !rawCatalog) {
    throw new Error('Missing package manifest or catalog');
  }
  const manifest = JSON.parse(strFromU8(rawManifest)) as Manifest;
  if (
    manifest.format !== 'anime-manager-catalog' ||
    manifest.schemaVersion !== 2 ||
    !manifest.files ||
    typeof manifest.files !== 'object'
  ) {
    throw new Error('Unsupported catalog package');
  }
  for (const [name, value] of Object.entries(manifest.files)) {
    const file = files[name];
    if (!file || file.length !== value.bytes || hash(file) !== value.sha256) {
      throw new Error(`Checksum mismatch: ${name}`);
    }
  }
  for (const name of Object.keys(files)) {
    if (name !== 'manifest.json' && !manifest.files[name]) {
      throw new Error('Unlisted package file');
    }
  }
  const catalog = validateCatalog(JSON.parse(strFromU8(rawCatalog)));
  if (
    catalog.id !== manifest.catalogId ||
    catalog.revision !== manifest.revision
  ) {
    throw new Error('Manifest identity does not match catalog');
  }
  const artwork: Record<string, Uint8Array> = {};
  for (const entry of catalog.entries) {
    if (entry.cover) {
      if (!artworkName(entry.cover) || !files[entry.cover]) {
        throw new Error(`Missing artwork for ${entry.title}`);
      }
      artwork[entry.cover] = files[entry.cover]!;
    }
  }
  const current = await repo.snapshot();
  return {
    catalog,
    artwork,
    warnings: [],
    expectedRevision: current.revision,
    differentCatalog: current.id !== catalog.id,
    divergent:
      current.id === catalog.id &&
      current.revision !== catalog.revision &&
      catalog.parentRevision !== current.revision,
  };
}

export async function applyImport(
  preview: ImportPreview,
  repo: JsonRepository,
  io: StorageAdapter,
): Promise<Catalog> {
  const before = await repo.snapshot();
  if (before.revision !== preview.expectedRevision) {
    throw new Error('Catalog changed; review the import again.');
  }
  await io.mkdir(`${io.privateRoot}/snapshots`);
  const archive = `${io.privateRoot}/snapshots/snapshot-${hash(
    strToU8(`${before.id}:${before.revision}`),
  ).slice(0, 32)}.json`;
  if (!(await io.exists(archive))) {
    await io.writeText(archive, JSON.stringify(before));
    validateCatalog(JSON.parse(await io.readText(archive)));
  }
  const next = cloneCatalog(preview.catalog);
  await io.mkdir(`${io.privateRoot}/artwork`);
  // New filenames avoid modifying covers used by the old snapshot or its backup.
  const mapping = new Map<string, string>();
  for (const [old, source] of Object.entries(preview.artwork)) {
    const extension = old.split('.').pop()!;
    const name = `artwork/${newId('import')}.${extension}`;
    if (typeof source === 'string') {
      if (!io.moveOwned) {
        throw new Error('This device cannot move unpacked artwork');
      }
      await io.moveOwned(source, `${io.privateRoot}/${name}`);
    } else {
      await io.writeBytes(`${io.privateRoot}/${name}`, source);
    }
    mapping.set(old, name);
  }
  for (const entry of next.entries) {
    if (entry.cover) {
      entry.cover = mapping.get(entry.cover) ?? null;
    }
  }
  // Device settings are deliberately untouched. Repository backs up previous snapshot.
  return repo.replaceCatalog(next, preview.expectedRevision);
}

export async function inspectSavedSnapshot(
  uri: string,
  repo: JsonRepository,
  io: StorageAdapter,
): Promise<ImportPreview> {
  const normalized = uri.replace(/\\/g, '/');
  if (
    !normalized.startsWith(
      io.privateRoot.replace(/\\/g, '/') + '/snapshots/',
    ) ||
    !/^snapshot-[a-f0-9]{32}\.json$/.test(normalized.split('/').pop() ?? '')
  ) {
    throw new Error('Select a locally archived snapshot.');
  }
  const catalog = validateCatalog(JSON.parse(await io.readText(uri)));
  const artwork: Record<string, Uint8Array> = {};
  for (const entry of catalog.entries) {
    if (entry.cover) {
      if (!artworkName(entry.cover)) {
        throw new Error('Invalid saved artwork reference');
      }
      artwork[entry.cover] = await io.readBytes(
        `${io.privateRoot}/${entry.cover}`,
      );
    }
  }
  const current = await repo.snapshot();
  return {
    catalog,
    artwork,
    expectedRevision: current.revision,
    differentCatalog: current.id !== catalog.id,
    divergent:
      current.id === catalog.id && current.revision !== catalog.revision,
    warnings: [
      'Restoring a locally archived snapshot. Device media locations stay unchanged.',
    ],
  };
}

/** Null when this image cannot be converted, so the original bytes are kept. */
async function coverAsWebp(
  source: string,
  io: StorageAdapter,
): Promise<Uint8Array | null> {
  const temporary = `${io.privateRoot}/artwork/${newId('convert')}.webp`;
  try {
    await io.mkdir(`${io.privateRoot}/artwork`);
    await io.thumbnail(source, temporary, 640);
    const bytes = await io.readBytes(temporary);
    await io.removeOwned(temporary);
    return bytes;
  } catch {
    return null;
  }
}

export async function inspectLegacyFolder(
  root: string,
  repo: JsonRepository,
  io: StorageAdapter,
): Promise<ImportPreview> {
  const files: LegacyFiles = {};
  const dataRoot = (await io.resolveChild(root, 'data')) ?? root;
  const registered = await io.list(dataRoot);
  const names = new Set([
    'sections.json',
    'anime_data.json',
    'manga_data.json',
    'anime_tracking.json',
    'queue.json',
    'anime_relations.json',
    'unique_anime_tags.json',
    'unique_manga_headers.json',
  ]);
  const sections = registered.find(f => f.name === 'sections.json');
  if (sections) {
    const raw = JSON.parse(await io.readText(sections.uri)) as {
      sections?: unknown[];
    };
    for (const value of raw.sections ?? []) {
      if (typeof value === 'string') {
        const slug = value.trim().toLowerCase().replace(/\s+/g, '_');
        if (/^[\p{L}\p{N}_-]+$/u.test(slug)) {
          names.add(`${slug}_data.json`);
        }
      }
    }
  }
  for (const file of registered) {
    if (names.has(file.name) && !file.directory) {
      files[file.name] = JSON.parse(await io.readText(file.uri));
    }
  }
  if (
    !files['anime_data.json'] &&
    !files['manga_data.json'] &&
    !files['sections.json']
  ) {
    throw new Error('Select the original Manager folder or its data folder.');
  }
  const migrated = migrateLegacy(files);
  const artwork: Record<string, Uint8Array> = {};
  for (const candidate of migrated.artwork) {
    const entry = migrated.catalog.entries.find(
      e => e.id === candidate.entryId,
    )!;
    for (const directory of candidate.directories) {
      const source = await io.resolveChild(root, directory);
      if (!source) {
        continue;
      }
      const safeTitle = candidate.title
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        // Windows drops trailing dots from file names.
        .replace(/[. ]+$/, '');
      const image = (await io.list(source)).find(
        f =>
          !f.directory &&
          ['webp', 'avif', 'jpg', 'jpeg', 'png', 'gif'].some(
            ext =>
              f.name.toLowerCase() === `${safeTitle}.${ext}`.toLowerCase() ||
              f.name.toLowerCase() ===
                `${candidate.title}.${ext}`.toLowerCase(),
          ),
      );
      if (image) {
        const extension = image.name.split('.').pop()!.toLowerCase();
        const converted =
          extension === 'webp' ? null : await coverAsWebp(image.uri, io);
        const bytes = converted ?? (await io.readBytes(image.uri));
        if (bytes.length > 8 * 1024 * 1024) {
          migrated.warnings.push(`Cover too large: ${entry.title}`);
          break;
        }
        const name = `artwork/${newId('legacy')}.${
          converted ? 'webp' : extension
        }`;
        entry.cover = name;
        artwork[name] = bytes;
        break;
      }
    }
  }
  const current = await repo.snapshot();
  return {
    catalog: migrated.catalog,
    artwork,
    warnings: migrated.warnings,
    expectedRevision: current.revision,
    differentCatalog: true,
    divergent: false,
  };
}
