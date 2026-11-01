import { Catalog, Entry, newId } from '../domain/catalog';
import { StorageAdapter } from '../platform/contracts';
import { DeviceSettings } from '../domain/catalog';
import { entryById } from './library';

export function setWatched(
  catalog: Catalog,
  entryId: string,
  watched: boolean,
  episodeId?: string,
): void {
  const entry = entryById(catalog, entryId);
  if (episodeId) {
    const episode = entry.episodes.find(ep => ep.id === episodeId);
    if (!episode) {
      throw new Error('Episode no longer exists');
    }
    episode.watched = watched;
    delete catalog.progress[episodeId];
  } else {
    entry.watched = watched;
    for (const episode of entry.episodes) {
      episode.watched = watched;
      delete catalog.progress[episode.id];
    }
  }
  if (entry.episodes.length) {
    entry.watched = entry.episodes.every(ep => ep.watched);
  }
}
export function addEpisode(
  catalog: Catalog,
  entryId: string,
  title: string,
): void {
  const entry = entryById(catalog, entryId);
  const number = Math.max(0, ...entry.episodes.map(e => e.number)) + 1;
  entry.episodes.push({
    id: newId('episode'),
    number,
    title: title.trim() || `Episode ${number}`,
    watched: false,
    relativeFile: `${number}.mp4`,
    legacy: {},
  });
  entry.watched = false;
}
export function removeEpisode(
  catalog: Catalog,
  entryId: string,
  episodeId: string,
): void {
  const entry = entryById(catalog, entryId);
  if (!entry.episodes.some(ep => ep.id === episodeId)) {
    throw new Error('Episode no longer exists');
  }
  entry.episodes = entry.episodes.filter(ep => ep.id !== episodeId);
  delete catalog.progress[episodeId];
  entry.watched =
    entry.episodes.length > 0 && entry.episodes.every(ep => ep.watched);
}
export function removeRecord(catalog: Catalog, entryId: string): void {
  const entry = entryById(catalog, entryId);
  for (const ep of entry.episodes) {
    delete catalog.progress[ep.id];
  }
  catalog.entries = catalog.entries.filter(e => e.id !== entryId);
  catalog.queue = catalog.queue.filter(id => id !== entryId);
  catalog.relations = catalog.relations
    .map(r => ({ ...r, entryIds: r.entryIds.filter(id => id !== entryId) }))
    .filter(r => r.entryIds.length >= 2);
  catalog.blockedPairs = catalog.blockedPairs.filter(
    pair => !pair.includes(entryId),
  );
}
export async function deleteLocalMedia(
  entry: Entry,
  settings: DeviceSettings,
  io: StorageAdapter,
): Promise<void> {
  const target = await resolvedDeleteTarget(entry, settings, io);
  // Compatibility for callers which remove the catalog record afterwards:
  // persist and verify a full recovery record before touching any media.
  const pending = `${io.privateRoot}/pending-deletions/${encodeURIComponent(
    entry.id,
  )}.json`;
  const text = JSON.stringify({
    entry,
    target,
    state: 'pending',
    createdAt: new Date().toISOString(),
  });
  await io.writeText(pending, text);
  if ((await io.readText(pending)) !== text) {
    throw new Error('Could not verify pending deletion; media was preserved.');
  }
  if (target) {
    await io.deleteMediaFolder(target.root, target.relativePath);
  }
  await removeOwnedCover(entry, io);
}

export type DeleteTarget = { root: string; relativePath: string; uri: string };

function documentIdentity(uri: string): string {
  const match =
    /^content:\/\/([^/]+)\/(?:.*\/)?(document|tree)\/([^/]+)\/?$/.exec(uri);
  return match ? `${match[1]}/${decodeURIComponent(match[3]!)}` : uri;
}

function relativeParts(path: string): string[] {
  const parts = path.replace(/\\/g, '/').split('/');
  if (
    parts.some(
      p =>
        !p ||
        p === '.' ||
        p === '..' ||
        p.includes(':') ||
        Array.from(p).some(c => c.charCodeAt(0) < 32),
    )
  ) {
    throw new Error('Unsafe media folder reference; files were preserved.');
  }
  return parts;
}

/** null means record-only deletion. Native code rechecks picker approval and containment. */
export async function resolvedDeleteTarget(
  entry: Entry,
  settings: DeviceSettings,
  io: StorageAdapter,
): Promise<DeleteTarget | null> {
  if (entry.kind !== 'anime') {
    return null;
  }
  const override = settings.titleFolders[entry.id];
  const root = settings.roots[entry.sectionId];
  if (!override) {
    if (!root || !entry.relativeFolder) {
      return null;
    }
    const relativePath = relativeParts(entry.relativeFolder).join('/');
    const uri = await io.resolveChild(root, relativePath);
    return uri ? { root, relativePath, uri } : null;
  }
  for (const approved of [...new Set(Object.values(settings.roots))]) {
    if (!approved.startsWith('content://')) {
      const normalize = (value: string) =>
        value
          .replace(/^file:\/\//, '')
          .replace(/\\/g, '/')
          .replace(/\/+$/, '');
      const parent = normalize(approved);
      const child = normalize(override);
      if (!child.toLowerCase().startsWith(parent.toLowerCase() + '/')) {
        continue;
      }
      const relativePath = relativeParts(child.slice(parent.length + 1)).join(
        '/',
      );
      const uri = await io.resolveChild(approved, relativePath);
      if (uri) {
        return { root: approved, relativePath, uri };
      }
    } else {
      // SAF document IDs are opaque. Establish ancestry by walking directories,
      // never by slicing or decoding a content URI.
      const queue = [{ uri: approved, parts: [] as string[] }];
      const visited = new Set<string>();
      for (let index = 0; index < queue.length; index++) {
        if (index >= 10000) {
          throw new Error(
            'Folder lookup limit reached. Select a closer media root before deleting.',
          );
        }
        const current = queue[index]!;
        if (visited.has(current.uri)) {
          continue;
        }
        visited.add(current.uri);
        for (const folder of (await io.list(current.uri)).filter(
          f => f.directory,
        )) {
          const parts = [...current.parts, ...relativeParts(folder.name)];
          if (documentIdentity(folder.uri) === documentIdentity(override)) {
            return {
              root: approved,
              relativePath: parts.join('/'),
              uri: folder.uri,
            };
          }
          if (parts.length < 64) {
            queue.push({ uri: folder.uri, parts });
          }
        }
      }
    }
  }
  return null;
}

/** Call from Library instead of deleting media before a catalog mutation. */
export async function deleteEntry(
  entry: Entry,
  settings: DeviceSettings,
  io: StorageAdapter,
  mutate: (change: (catalog: Catalog) => void) => Promise<unknown>,
): Promise<void> {
  const target = await resolvedDeleteTarget(entry, settings, io);
  await mutate(c => {
    const current = entryById(c, entry.id);
    current.legacy.pendingDeletion = {
      target,
      requestedAt: new Date().toISOString(),
    };
  });
  // Failure retains the record with its pending marker, so deletion is retryable.
  if (target) {
    await io.deleteMediaFolder(target.root, target.relativePath);
  }
  let coverIsShared = false;
  await mutate(c => {
    removeRecord(c, entry.id);
    coverIsShared = c.entries.some(e => e.cover === entry.cover);
  });
  if (!coverIsShared) {
    await removeOwnedCover(entry, io);
  }
}

export async function removeOwnedCover(
  entry: Entry,
  io: StorageAdapter,
): Promise<void> {
  if (
    entry.cover &&
    /^artwork\/[^/\\:]+\.(webp|png|jpe?g|gif)$/i.test(entry.cover) &&
    !entry.cover.includes('..')
  ) {
    await io.removeOwned(`${io.privateRoot}/${entry.cover}`);
  }
}
