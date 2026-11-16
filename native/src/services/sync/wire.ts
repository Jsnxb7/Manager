import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { Catalog, cloneCatalog, validateCatalog } from '../../domain/catalog';
import { StorageAdapter } from '../../platform/contracts';

/**
 * What travels between devices. Covers go by content hash (`sha:<hex>`), since
 * each device names its own cover files; device-only details stay behind.
 */

export type CoverHashes = Record<string, string>;
type Io = Pick<
  StorageAdapter,
  | 'hashFiles'
  | 'privateRoot'
  | 'exists'
  | 'readText'
  | 'writeText'
  | 'readBytes'
  | 'writeBytes'
  | 'replace'
  | 'mkdir'
  | 'list'
>;

const HASHES = 'cover-hashes.json';
const SHA = /^sha:([0-9a-f]{64})$/;

export const isCoverHash = (value: string | null): boolean =>
  !!value && SHA.test(value);

/** Cover file name -> content hash. File names are never reused, so this never goes stale. */
export async function loadCoverHashes(io: Io): Promise<CoverHashes> {
  const path = `${io.privateRoot}/${HASHES}`;
  try {
    return (await io.exists(path))
      ? (JSON.parse(await io.readText(path)) as CoverHashes)
      : {};
  } catch {
    return {};
  }
}
export async function saveCoverHashes(
  io: Io,
  hashes: CoverHashes,
): Promise<void> {
  await writeStaged(io, `${io.privateRoot}/${HASHES}`, JSON.stringify(hashes));
}

async function writeStaged(io: Io, path: string, text: string): Promise<void> {
  await io.writeText(`${path}.staged`, text);
  await io.replace(`${path}.staged`, path);
}

/** The catalog as sent: covers as hashes, device-only details removed. */
export async function toWire(
  catalog: Catalog,
  io: Io,
  hashes: CoverHashes,
): Promise<{
  catalog: Catalog;
  files: Map<string, string>;
  /** Titles whose cover file is missing on this device (sent as no cover). */
  missingCovers: string[];
}> {
  const wire = cloneCatalog(catalog);
  const files = new Map<string, string>();
  const missingCovers: string[] = [];
  let learned = false;
  // Hash new covers natively in batches where the device can (far faster).
  if (io.hashFiles) {
    const unknown = [
      ...new Set(
        wire.entries.flatMap(e =>
          e.cover && !isCoverHash(e.cover) && !hashes[e.cover] ? [e.cover] : [],
        ),
      ),
    ];
    for (let i = 0; i < unknown.length; i += 100) {
      const batch = unknown.slice(i, i + 100);
      const found = await io.hashFiles(
        batch.map(name => `${io.privateRoot}/${name}`),
      );
      for (const name of batch) {
        const hash = found[`${io.privateRoot}/${name}`];
        if (hash) {
          hashes[name] = hash;
          learned = true;
        }
      }
    }
  }
  const present = await presentFiles(
    io,
    wire.entries.flatMap(e =>
      e.cover && !isCoverHash(e.cover) ? [e.cover] : [],
    ),
  );
  for (const entry of wire.entries) {
    // A pending deletion records this device's folder paths.
    delete entry.legacy.pendingDeletion;
    if (!entry.cover || isCoverHash(entry.cover)) {
      continue;
    }
    const path = `${io.privateRoot}/${entry.cover}`;
    // A known hash is no proof that the file is still here. The listing is only
    // a shortcut: anything it lacks (say, a different letter case) is asked about.
    const there = !!present?.has(entry.cover) || (await io.exists(path));
    if (!there) {
      // Not a removal: the merge must not spread a lost file to the other side.
      entry.cover = null;
      missingCovers.push(entry.id);
      continue;
    }
    let hash = hashes[entry.cover];
    if (!hash) {
      hash = bytesToHex(sha256(await io.readBytes(path)));
      hashes[entry.cover] = hash;
      learned = true;
    }
    files.set(hash, entry.cover);
    entry.cover = `sha:${hash}`;
  }
  if (learned) {
    await saveCoverHashes(io, hashes);
  }
  return { catalog: wire, files, missingCovers };
}

/**
 * Which of these private files exist, from one listing per folder instead of a
 * call per file. Null when a folder cannot be listed (callers check each file).
 */
async function presentFiles(
  io: Io,
  names: string[],
): Promise<Set<string> | null> {
  const folders = new Set(
    names.map(n => (n.includes('/') ? n.slice(0, n.lastIndexOf('/')) : '')),
  );
  const present = new Set<string>();
  try {
    for (const folder of folders) {
      const uri = folder ? `${io.privateRoot}/${folder}` : io.privateRoot;
      if (!(await io.exists(uri))) {
        continue;
      }
      for (const file of await io.list(uri)) {
        if (!file.directory) {
          present.add(folder ? `${folder}/${file.name}` : file.name);
        }
      }
    }
  } catch {
    return null;
  }
  return present;
}

/** Back to this device's own cover file names; every cover must already be here. */
export function fromWire(wire: Catalog, files: Map<string, string>): Catalog {
  const catalog = cloneCatalog(wire);
  for (const entry of catalog.entries) {
    const match = entry.cover ? SHA.exec(entry.cover) : null;
    if (match) {
      const name = files.get(match[1]!);
      if (!name) {
        throw new Error(`Cover for ${entry.title} did not arrive`);
      }
      entry.cover = name;
    }
  }
  return validateCatalog(catalog);
}

/** Hashes of all covers a wire catalog refers to. */
export function coverHashesIn(wire: Catalog): Set<string> {
  const result = new Set<string>();
  for (const entry of wire.entries) {
    const match = entry.cover ? SHA.exec(entry.cover) : null;
    if (match) {
      result.add(match[1]!);
    }
  }
  return result;
}

/** Saves a received cover after checking it is what was asked for. */
export async function storeCover(
  io: Io,
  hash: string,
  bytes: Uint8Array,
  hashes: CoverHashes,
): Promise<string> {
  if (bytesToHex(sha256(bytes)) !== hash) {
    throw new Error('A cover was damaged on the way');
  }
  const name = `artwork/sync-${hash.slice(0, 16)}.${imageExtension(bytes)}`;
  await io.mkdir(`${io.privateRoot}/artwork`);
  await io.writeBytes(`${io.privateRoot}/${name}`, bytes);
  hashes[name] = hash;
  return name;
}

export function imageExtension(bytes: Uint8Array): string {
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return 'webp';
  }
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') {
    return 'png';
  }
  if (ascii(0, 3) === 'GIF') {
    return 'gif';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return 'jpg';
  }
  throw new Error('A cover is not an image');
}

/** The catalog both devices agreed on at their last sync, in wire form. */
const basePath = (io: Io, catalogId: string) =>
  `${io.privateRoot}/sync-base-${catalogId.replace(/[^\w-]/g, '_')}.json`;
export async function loadBase(
  io: Io,
  catalogId: string,
): Promise<Catalog | null> {
  const path = basePath(io, catalogId);
  if (!(await io.exists(path))) {
    return null;
  }
  try {
    return validateCatalog(JSON.parse(await io.readText(path)));
  } catch {
    // A damaged base only makes the next sync a first sync.
    return null;
  }
}
export async function saveBase(io: Io, wire: Catalog): Promise<void> {
  await writeStaged(io, basePath(io, wire.id), JSON.stringify(wire));
}

/* eslint-disable no-bitwise -- base64 is bit arithmetic */
const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? ALPHABET[n & 63]! : '=';
  }
  return out;
}
export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (ALPHABET.indexOf(clean[i]!) << 18) |
      (ALPHABET.indexOf(clean[i + 1]!) << 12) |
      ((clean[i + 2] ? ALPHABET.indexOf(clean[i + 2]!) : 0) << 6) |
      (clean[i + 3] ? ALPHABET.indexOf(clean[i + 3]!) : 0);
    out[o++] = (n >> 16) & 255;
    if (clean[i + 2]) out[o++] = (n >> 8) & 255;
    if (clean[i + 3]) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}
/* eslint-enable no-bitwise */
