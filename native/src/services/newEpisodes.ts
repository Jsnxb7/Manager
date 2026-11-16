import { useEffect, useState } from 'react';
import { Catalog, DeviceSettings, newId } from '../domain/catalog';
import { StorageAdapter } from '../platform/contracts';
import { entryById } from './library';
import { MediaResolver } from './media';

/**
 * Episode files found in title folders beyond the episodes a title has. The last
 * scan is cached on the device so badges show at once; the app rescans on every
 * start and when asked to refresh.
 */
export type FoundEpisode = { number: number; file: string };
export type NewEpisodeScan = {
  scannedAt: string | null;
  /** Titles with new files. */
  titles: Record<string, FoundEpisode[]>;
  /** Per title, the set of numbers the user chose not to add ("1,2,3"). */
  dismissed: Record<string, string>;
};

const FILE = 'new-episodes.json';
const empty = (): NewEpisodeScan => ({
  scannedAt: null,
  titles: {},
  dismissed: {},
});

let current: NewEpisodeScan = empty();
let scanning = false;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(fn => fn());

const keyOf = (found: FoundEpisode[]) => found.map(f => f.number).join(',');

/** New files for one title, unless the user dismissed exactly this set. */
export function newFor(scan: NewEpisodeScan, entryId: string): FoundEpisode[] {
  const found = scan.titles[entryId] ?? [];
  return found.length && scan.dismissed[entryId] !== keyOf(found) ? found : [];
}

export function useNewEpisodes(): {
  scan: NewEpisodeScan;
  scanning: boolean;
} {
  const [, redraw] = useState(0);
  useEffect(() => {
    const listener = () => redraw(n => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return { scan: current, scanning };
}

type Io = Pick<
  StorageAdapter,
  'privateRoot' | 'exists' | 'readText' | 'writeText' | 'replace'
>;

async function save(io: Io): Promise<void> {
  const staged = `${io.privateRoot}/${FILE}.staged`;
  await io.writeText(staged, JSON.stringify(current));
  await io.replace(staged, `${io.privateRoot}/${FILE}`);
}

/** Reads the cached result once, so badges appear before the rescan ends. */
export async function loadNewEpisodes(io: Io): Promise<void> {
  if (loaded) {
    return;
  }
  loaded = true;
  try {
    const path = `${io.privateRoot}/${FILE}`;
    if (await io.exists(path)) {
      const raw = JSON.parse(
        await io.readText(path),
      ) as Partial<NewEpisodeScan>;
      current = {
        scannedAt: typeof raw.scannedAt === 'string' ? raw.scannedAt : null,
        titles: raw.titles && typeof raw.titles === 'object' ? raw.titles : {},
        dismissed:
          raw.dismissed && typeof raw.dismissed === 'object'
            ? raw.dismissed
            : {},
      };
      emit();
    }
  } catch {
    // A damaged cache only means waiting for the rescan.
  }
}

/** Scans every anime title with a folder. Returns how many titles have new files. */
export async function refreshNewEpisodes(
  io: StorageAdapter,
  catalog: Catalog,
  settings: DeviceSettings,
): Promise<number> {
  if (scanning) {
    return Object.keys(current.titles).length;
  }
  scanning = true;
  emit();
  try {
    await loadNewEpisodes(io);
    const resolver = new MediaResolver(io);
    const titles: NewEpisodeScan['titles'] = {};
    const candidates = catalog.entries.filter(
      e =>
        e.kind === 'anime' &&
        (settings.titleFolders[e.id] ||
          (settings.roots[e.sectionId] && e.relativeFolder)),
    );
    // A few folders at a time: listing is cheap on PC, slower through Android's
    // document provider.
    for (let i = 0; i < candidates.length; i += 4) {
      await Promise.all(
        candidates.slice(i, i + 4).map(async entry => {
          try {
            const { folder } = await resolver.scan(entry, settings);
            if (folder?.newEpisodes.length) {
              titles[entry.id] = folder.newEpisodes.map(n => ({
                number: n.number,
                file: n.file.name,
              }));
            }
          } catch {
            // An unreadable folder shows on Details; it has no new files to offer.
          }
        }),
      );
    }
    const dismissed: NewEpisodeScan['dismissed'] = {};
    for (const [id, key] of Object.entries(current.dismissed)) {
      if (titles[id]) {
        dismissed[id] = key;
      }
    }
    current = { scannedAt: new Date().toISOString(), titles, dismissed };
    await save(io).catch(() => undefined);
    return Object.keys(titles).filter(id => newFor(current, id).length).length;
  } finally {
    scanning = false;
    emit();
  }
}

/** Stores what a Details scan found, so the badge follows without a second scan. */
export function recordTitle(
  io: Io,
  entryId: string,
  found: { number: number; file: { name: string } }[],
): void {
  const next = found.map(n => ({ number: n.number, file: n.file.name }));
  if (keyOf(next) === keyOf(current.titles[entryId] ?? [])) {
    return;
  }
  const titles = { ...current.titles };
  if (next.length) {
    titles[entryId] = next;
  } else {
    delete titles[entryId];
  }
  current = { ...current, titles };
  emit();
  save(io).catch(() => undefined);
}

/** Rescans one title after a change on Details. */
export async function refreshTitle(
  io: StorageAdapter,
  catalog: Catalog,
  settings: DeviceSettings,
  entryId: string,
): Promise<void> {
  const entry = catalog.entries.find(e => e.id === entryId);
  if (!entry) {
    return;
  }
  const { folder } = await new MediaResolver(io).scan(entry, settings);
  const titles = { ...current.titles };
  if (folder?.newEpisodes.length) {
    titles[entryId] = folder.newEpisodes.map(n => ({
      number: n.number,
      file: n.file.name,
    }));
  } else {
    delete titles[entryId];
  }
  current = { ...current, titles };
  emit();
  await save(io).catch(() => undefined);
}

export async function dismissNewEpisodes(
  io: Io,
  entryId: string,
): Promise<void> {
  const found = current.titles[entryId];
  if (!found) {
    return;
  }
  current = {
    ...current,
    dismissed: { ...current.dismissed, [entryId]: keyOf(found) },
  };
  emit();
  await save(io);
}

/** Adds episode records for found files; each keeps its file name. */
export function addFoundEpisodes(
  catalog: Catalog,
  entryId: string,
  found: FoundEpisode[],
): number {
  const entry = entryById(catalog, entryId);
  const known = new Set(entry.episodes.map(ep => ep.number));
  let added = 0;
  for (const item of found) {
    if (known.has(item.number)) {
      continue;
    }
    entry.episodes.push({
      id: newId('episode'),
      number: item.number,
      title: `Episode ${item.number}`,
      watched: false,
      relativeFile: item.file,
      legacy: {},
    });
    known.add(item.number);
    added++;
  }
  entry.episodes.sort((a, b) => a.number - b.number);
  if (added) {
    entry.watched = false;
  }
  return added;
}

/** Drops a title from the cached result once its files were added. */
export async function forgetFound(io: Io, entryId: string): Promise<void> {
  const titles = { ...current.titles };
  delete titles[entryId];
  current = { ...current, titles };
  emit();
  await save(io).catch(() => undefined);
}
