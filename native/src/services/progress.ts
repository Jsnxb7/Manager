import { Catalog } from '../domain/catalog';
import { entryById } from './library';
export function saveProgress(
  catalog: Catalog,
  entryId: string,
  episodeId: string,
  time: number,
  duration: number,
  ended = false,
): void {
  const entry = entryById(catalog, entryId);
  const ep = entry.episodes.find(e => e.id === episodeId);
  if (!ep) {
    throw new Error('Episode no longer exists');
  }
  const total = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const current = Number.isFinite(time)
    ? Math.min(Math.max(0, time), total || Number.MAX_SAFE_INTEGER)
    : 0;
  const updatedAt = new Date().toISOString();
  if (ended || (total > 0 && current / total >= 0.9)) {
    ep.watched = true;
    delete catalog.progress[episodeId];
  } else if (current > 1 && !ep.watched) {
    catalog.progress[episodeId] = {
      entryId,
      episodeId,
      currentTime: current,
      duration: total,
      updatedAt,
    };
  }
  entry.watched =
    entry.episodes.length > 0 && entry.episodes.every(e => e.watched);
  catalog.legacy.lastUse = {
    entryId,
    episodeId,
    currentTime: current,
    duration: total,
    updatedAt,
  };
}
export type PlaybackState = {
  position: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  ready: boolean;
  closed: boolean;
  error: string;
  /** Set once when the native controls ask for another episode. */
  request?: string;
  audio: { id: string; label: string }[];
  subtitles: { id: string; label: string }[];
};
export class CompletionGuard {
  private finished = false;
  shouldAdvance(ended: boolean): boolean {
    if (!ended || this.finished) {
      return false;
    }
    this.finished = true;
    return true;
  }
}
export function subtitleToVtt(text: string): string {
  if (text.replace(/^\uFEFF/, '').startsWith('WEBVTT')) {
    return text;
  }
  return `WEBVTT\n\n${text
    .replace(/^\uFEFF/, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`;
}
