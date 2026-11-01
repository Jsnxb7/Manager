import { Catalog, Entry, Episode } from '../domain/catalog';
import { Route } from '../app/routes';
import { relationFor } from './relations';
export type PlaybackTarget = {
  entryId: string;
  episodeId: string;
  resume: boolean;
  type: 'episode' | 'relation' | 'queue';
  queueAnchor: string | null;
};
const sorted = (entry: Entry): Episode[] =>
  [...entry.episodes].sort((a, b) => a.number - b.number);
export function startEpisode(
  c: Catalog,
  entry: Entry,
): { episode: Episode; resume: boolean } | null {
  const episodes = sorted(entry);
  const progress = Object.values(c.progress)
    .filter(
      p =>
        p.entryId === entry.id &&
        p.currentTime > 1 &&
        episodes.some(ep => ep.id === p.episodeId && !ep.watched),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (progress) {
    return {
      episode: episodes.find(e => e.id === progress.episodeId)!,
      resume: true,
    };
  }
  const episode = episodes.find(ep => !ep.watched) ?? episodes[0];
  return episode ? { episode, resume: false } : null;
}
export function queueTarget(c: Catalog, id: string): PlaybackTarget | null {
  const entry = c.entries.find(e => e.id === id && e.kind === 'anime');
  if (!entry) {
    return null;
  }
  const start = startEpisode(c, entry);
  return start
    ? {
        entryId: id,
        episodeId: start.episode.id,
        resume: start.resume,
        type: 'queue',
        queueAnchor: id,
      }
    : null;
}
export function resolveTarget(
  c: Catalog,
  entryId: string,
  episodeId: string,
  direction: 1 | -1,
  anchor: string | null = null,
): PlaybackTarget | null {
  const current = c.entries.find(e => e.id === entryId);
  if (!current) {
    return null;
  }
  const episodes = sorted(current);
  const index = episodes.findIndex(e => e.id === episodeId);
  if (index < 0) {
    return null;
  }
  const queueAnchor = anchor ?? (c.queue.includes(entryId) ? entryId : null);
  const adjacent = episodes[index + direction];
  if (adjacent) {
    return {
      entryId,
      episodeId: adjacent.id,
      resume: false,
      type: 'episode',
      queueAnchor,
    };
  }
  const relation = relationFor(c, entryId);
  const relations = relation?.entryIds ?? [];
  const position = relations.indexOf(entryId);
  for (
    let i = position + direction;
    position >= 0 && i >= 0 && i < relations.length;
    i += direction
  ) {
    const entry = c.entries.find(e => e.id === relations[i]);
    if (!entry) {
      continue;
    }
    const start =
      direction === 1
        ? startEpisode(c, entry)
        : sorted(entry).at(-1)
        ? { episode: sorted(entry).at(-1)!, resume: false }
        : null;
    if (start) {
      return {
        entryId: entry.id,
        episodeId: start.episode.id,
        resume: start.resume,
        type: 'relation',
        queueAnchor,
      };
    }
  }
  const cursor = queueAnchor ? c.queue.indexOf(queueAnchor) : -1;
  for (
    let i = cursor + direction;
    i >= 0 && i < c.queue.length;
    i += direction
  ) {
    const id = c.queue[i]!;
    if (id === entryId || relations.includes(id)) {
      continue;
    }
    const entry = c.entries.find(e => e.id === id);
    if (!entry) {
      continue;
    }
    const start =
      direction === 1
        ? startEpisode(c, entry)
        : sorted(entry).at(-1)
        ? { episode: sorted(entry).at(-1)!, resume: false }
        : null;
    if (start) {
      return {
        entryId: id,
        episodeId: start.episode.id,
        resume: start.resume,
        type: 'queue',
        queueAnchor: id,
      };
    }
  }
  return null;
}
export const targetRoute = (target: PlaybackTarget): Route => ({
  name: 'player',
  animeId: target.entryId,
  episodeId: target.episodeId,
  resume: target.resume,
  ...(target.queueAnchor ? { queueAnchor: target.queueAnchor } : {}),
});
export function reorderQueue(c: Catalog, ids: string[]): void {
  if (
    ids.length !== c.queue.length ||
    new Set(ids).size !== ids.length ||
    ids.some(id => !c.queue.includes(id))
  ) {
    throw new Error('Queue changed; reload before reordering.');
  }
  c.queue = [...ids];
}
export function clearWatchedQueue(c: Catalog): void {
  c.queue = c.queue.filter(id => {
    const e = c.entries.find(v => v.id === id);
    return e && !e.watched;
  });
}
