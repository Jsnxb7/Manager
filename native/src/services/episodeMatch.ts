import { Entry } from '../domain/catalog';
import { FileEntry } from '../platform/contracts';

/**
 * Matches the video files of one title folder to its episodes. Pure: the caller
 * lists the folder and passes the files, so Details, playback, "Review matches" and
 * new-episode detection all agree on one result.
 */

export const VIDEO_EXTENSION = /\.(mp4|mkv|webm|avi|mov|m4v)$/i;

export type ParsedName = {
  number: number | null;
  /** Release version, `03v2` → 2; 1 when not given. */
  version: number;
  /** Release group from a leading `[Group]`. */
  group: string | null;
  /** Vertical resolution, e.g. `1080p`. */
  resolution: string | null;
  /** `extra`: openings, previews and the like; `special`: OVA/SP files. */
  kind: 'episode' | 'extra' | 'special';
};

// Creditless openings/endings, previews, trailers and other non-episodes.
const EXTRA_TOKEN =
  /^(?:nc(?:op|ed)\d*|creditless|op\d*|ed\d*|pv\d*|cm\d*|preview|previews|trailer|teaser|sample|recap|menu|menus)$/i;
// Counted only when the title itself is an OVA or special.
const SPECIAL_TOKEN =
  /^(?:ova\d*|oad\d*|ona|sp\d*|special|specials|extra|extras|bonus|omake)$/i;
const YEAR = /(?:^|[\s._-])((?:19[5-9]|20[0-3])\d)(?=[\s._-]|$)/g;

function numberIn(stem: string): number | null {
  if (/^\d+$/.test(stem.trim())) {
    return Number(stem.trim());
  }
  // Explicit episode markers and release separators outrank title numbers.
  const match =
    /(?:^|[\s._[(-])(?:s\d{1,2}e|episodes?|eps?|ep|e)[\s._-]*(\d{1,4})(?:v\d+)?(?=[\s._\])[-]|$)/i.exec(
      stem,
    ) ??
    /(?:^|[\s_])-+[\s_]*(\d{1,4})(?:v\d+)?(?=[\s._\])[-]|$)/i.exec(stem) ??
    [
      ...stem.matchAll(
        /(?:^|[\s._-])(\d{1,4})(?:v\d+)?(?:[\s._-]*(?:end|final))?(?=[\s._\])[-]|$)/gi,
      ),
    ].pop();
  return match?.[1] ? Number(match[1]) : null;
}

/** Reads what a video file name says about itself; null for non-videos. */
export function parseVideoName(name: string): ParsedName | null {
  if (!VIDEO_EXTENSION.test(name)) {
    return null;
  }
  const raw = name.replace(/\.[^.]+$/, '');
  const group = /^\s*\[([^\]]+)\]/.exec(raw)?.[1]?.trim() || null;
  const height =
    /(?:^|[^0-9])(2160|1440|1080|720|576|480|360)p/i.exec(raw)?.[1] ??
    /\d{3,4}x(2160|1440|1080|720|576|480|360)\b/i.exec(raw)?.[1];
  const version = Number(/\d{1,4}v(\d)(?![0-9])/i.exec(raw)?.[1] ?? 1);
  const tokens = raw.split(/[\s._\-[\]()]+/).filter(Boolean);
  const kind = tokens.some(t => EXTRA_TOKEN.test(t))
    ? 'extra'
    : tokens.some(t => SPECIAL_TOKEN.test(t))
    ? 'special'
    : 'episode';
  const stem = raw
    // A bracket holding only a number is the episode: `Show [01].mkv`.
    .replace(/\[\s*(\d{1,4}(?:v\d)?)\s*\]/g, ' $1 ')
    // Other brackets hold the group, checksum, resolution, codec or year.
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b[0-9a-f]{8}\b/gi, ' ')
    .replace(
      /\b(?:\d{3,4}p|\d{3,4}x\d{3,4}|[xh]\.?26[45]|\d{1,2}bit)\b/gi,
      ' ',
    );
  // A year counts only when it is the only number left.
  const withoutYear = stem.replace(YEAR, ' ');
  const number = numberIn(withoutYear) ?? numberIn(stem);
  return {
    number,
    version,
    group,
    resolution: height ? `${height}p` : null,
    kind,
  };
}

export function episodeNumber(name: string): number | null {
  return parseVideoName(name)?.number ?? null;
}

export type EpisodeMatch =
  | { state: 'matched'; file: FileEntry; reason: string }
  | { state: 'ambiguous'; files: FileEntry[] }
  | { state: 'none' };

export type FolderMatch = {
  episodes: Record<string, EpisodeMatch>;
  /** File number = episode number + offset (a later season numbered from 13). */
  offset: number;
  /** Openings, previews and other files that are not episodes. */
  extras: FileEntry[];
  /** Numbered episode files beyond the title's episodes, one per number. */
  newEpisodes: { number: number; file: FileEntry }[];
  /** Video files with no episode number and no match. */
  unmatched: FileEntry[];
};

type Candidate = { file: FileEntry; parsed: ParsedName; number: number };

function majority(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function seasonNumber(season: string): number | null {
  const match =
    /(?:season|s)\s*0*(\d{1,2})\b/i.exec(season) ??
    /\b(\d{1,2})(?:st|nd|rd|th)\b/i.exec(season);
  return match ? Number(match[1]) : null;
}

/** Whether OVA/SP files are this title's episodes. */
export function isSpecialTitle(
  entry: Pick<Entry, 'title' | 'season'>,
): boolean {
  return `${entry.title} ${entry.season}`
    .split(/[\s._\-[\]()]+/)
    .some(t => SPECIAL_TOKEN.test(t));
}

/** Picks the best of several files for one episode, or null on a true tie. */
function rank(
  files: Candidate[],
  group: string | null,
  resolution: string | null,
): { pick: Candidate; why: string } | null {
  const score = (c: Candidate) => [
    c.parsed.version,
    group && c.parsed.group === group ? 1 : 0,
    resolution && c.parsed.resolution === resolution ? 1 : 0,
  ];
  const sorted = [...files].sort((a, b) => {
    const x = score(a);
    const y = score(b);
    return y[0]! - x[0]! || y[1]! - x[1]! || y[2]! - x[2]!;
  });
  const [first, second] = sorted.map(score);
  const differs = first!.findIndex((value, i) => value !== second![i]);
  if (differs < 0) {
    return null;
  }
  const others = files.length - 1;
  const over = `over ${others} other file${others === 1 ? '' : 's'}`;
  const why =
    differs === 0
      ? `Newer version (v${first![0]}) chosen ${over}`
      : differs === 1
      ? `Same release group as the rest, chosen ${over}`
      : `Same resolution as the rest, chosen ${over}`;
  return { pick: sorted[0]!, why };
}

/**
 * `fixed` holds episodes already settled by the caller (a file linked with Locate,
 * or the saved file name found in the folder); their files are not reused.
 */
export function matchFolder(
  entry: Pick<Entry, 'title' | 'season' | 'episodes'>,
  videos: FileEntry[],
  fixed: Record<string, { file: FileEntry; reason: string }> = {},
): FolderMatch {
  const episodes: Record<string, EpisodeMatch> = {};
  const taken = new Set<string>();
  for (const [id, value] of Object.entries(fixed)) {
    episodes[id] = { state: 'matched', ...value };
    taken.add(value.file.uri);
  }
  const specials = isSpecialTitle(entry);
  const extras: FileEntry[] = [];
  const candidates: Candidate[] = [];
  const unnumbered: FileEntry[] = [];
  for (const file of videos) {
    if (taken.has(file.uri)) {
      continue;
    }
    const parsed = parseVideoName(file.name);
    if (!parsed) {
      continue;
    }
    if (parsed.kind === 'extra' || (parsed.kind === 'special' && !specials)) {
      extras.push(file);
    } else if (parsed.number === null || parsed.number < 1) {
      unnumbered.push(file);
    } else {
      candidates.push({ file, parsed, number: parsed.number });
    }
  }
  const open = entry.episodes.filter(ep => !episodes[ep.id]);
  // A later season is often numbered on from the first: files 13-24 for 1-12.
  // Use the shift that matches the most episodes; no shift wins a tie.
  const fileNumbers = new Set(candidates.map(c => c.number));
  const matches = (offset: number) =>
    open.filter(ep => fileNumbers.has(ep.number + offset)).length;
  const minFile = Math.min(...candidates.map(c => c.number));
  let offset = 0;
  if (candidates.length) {
    if (entry.episodes.length) {
      const minEpisode = Math.min(...open.map(ep => ep.number));
      const shift = minFile - minEpisode;
      if (open.length && shift > 0 && matches(shift) > matches(0)) {
        offset = shift;
      }
    } else if ((seasonNumber(entry.season) ?? 1) > 1 && minFile > 1) {
      offset = minFile - 1;
    }
  }
  const group = majority(candidates.map(c => c.parsed.group));
  const resolution = majority(candidates.map(c => c.parsed.resolution));
  const byNumber = new Map<number, Candidate[]>();
  for (const c of candidates) {
    const n = c.number - offset;
    byNumber.set(n, [...(byNumber.get(n) ?? []), c]);
  }
  const shifted = (file: Candidate) =>
    offset ? `Numbered ${file.number} in this folder` : '';
  for (const ep of open) {
    const claims = byNumber.get(ep.number) ?? [];
    if (claims.length === 1) {
      episodes[ep.id] = {
        state: 'matched',
        file: claims[0]!.file,
        reason: shifted(claims[0]!) || 'Episode number in the file name',
      };
    } else if (claims.length > 1) {
      const best = rank(claims, group, resolution);
      episodes[ep.id] = best
        ? {
            state: 'matched',
            file: best.pick.file,
            reason: [shifted(best.pick), best.why].filter(Boolean).join('. '),
          }
        : { state: 'ambiguous', files: claims.map(c => c.file) };
    }
    const result = episodes[ep.id];
    if (result) {
      claims.forEach(c => taken.add(c.file.uri));
    }
  }
  // Only unnumbered files, as many as the episodes: match them in name order.
  const unmatched = [...unnumbered];
  if (!candidates.length && unnumbered.length === entry.episodes.length) {
    const sorted = [...unnumbered].sort((a, b) => a.name.localeCompare(b.name));
    for (const ep of open) {
      const file = sorted[ep.number - 1];
      if (file && !taken.has(file.uri)) {
        episodes[ep.id] = {
          state: 'matched',
          file,
          reason: 'No episode numbers in the folder; matched by name order',
        };
        taken.add(file.uri);
      }
    }
    unmatched.splice(
      0,
      unmatched.length,
      ...unnumbered.filter(f => !taken.has(f.uri)),
    );
  }
  for (const ep of entry.episodes) {
    episodes[ep.id] ??= { state: 'none' };
  }
  const known = new Set(entry.episodes.map(ep => ep.number));
  const newEpisodes: FolderMatch['newEpisodes'] = [];
  for (const [number, claims] of byNumber) {
    if (number < 1 || known.has(number)) {
      continue;
    }
    const best =
      claims.length === 1 ? claims[0]! : rank(claims, group, resolution)?.pick;
    if (best) {
      newEpisodes.push({ number, file: best.file });
    }
  }
  newEpisodes.sort((a, b) => a.number - b.number);
  return { episodes, offset, extras, newEpisodes, unmatched };
}
