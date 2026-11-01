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
  if (entry.kind !== 'anime') {
    return;
  }
  if (settings.titleFolders[entry.id]) {
    throw new Error(
      'This title uses a folder override. Link its parent library root before deleting local media.',
    );
  }
  const root = settings.roots[entry.sectionId];
  if (!root) {
    throw new Error(
      'Select the local anime media root before deleting this title and its media.',
    );
  }
  if (!entry.relativeFolder) {
    throw new Error(
      'This title needs a local folder mapping before media deletion.',
    );
  }
  await io.deleteMediaFolder(root, entry.relativeFolder);
}
