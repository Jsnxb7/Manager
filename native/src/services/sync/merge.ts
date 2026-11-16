import {
  Catalog,
  Entry,
  Episode,
  METADATA_GROUPS,
  Metadata,
  cloneCatalog,
  newId,
} from '../../domain/catalog';

/**
 * Three-way catalog merge for PC <-> phone sync.
 *
 * `base` is the catalog both devices agreed on at their last sync (null before the
 * first one). A change made on one side only is taken as is; a title changed on
 * both sides merges field by field, and only fields both changed differently
 * become a conflict for the person to settle. Watch progress takes the newest.
 *
 * Sync only adds and updates. The one removal it carries across is a whole
 * title or a whole episode deleted on one side; anything else one side emptied
 * or dropped (a cover, a link, labels, sections, queue places, related groups,
 * resume points) is kept from the side that still has it.
 *
 * Covers are compared by content, not file name: callers replace `entry.cover`
 * with `sha:<hash>` before merging, since each device names its files itself.
 */

export type Conflict = {
  id: string;
  title: string;
  local: Entry;
  remote: Entry;
};
/** One line of the confirmation: what a sync changes about one title or list. */
export type Change = {
  key: string;
  title: string;
  kind: 'added' | 'removed' | 'changed';
  details: string[];
};
export type MergeResult = {
  catalog: Catalog;
  conflicts: Conflict[];
  /** What each side gains, title by title, for the confirmation. */
  changes: { toLocal: Change[]; toRemote: Change[] };
};

/**
 * A cover file missing on one device says nothing about the cover: that side
 * takes the other side's cover (or the agreed one), so the merge keeps it and
 * the sync brings the file back. Lost on both sides, it stays empty.
 */
export function fillMissingCovers(
  base: Catalog | null,
  local: Catalog,
  remote: Catalog,
  localMissing: string[],
  remoteMissing: string[],
): void {
  const find = (c: Catalog | null, id: string) =>
    c?.entries.find(e => e.id === id);
  const lostLocal = new Set(localMissing);
  const lostRemote = new Set(remoteMissing);
  const fill = (
    side: Catalog,
    other: Catalog,
    lost: Set<string>,
    otherLost: Set<string>,
  ) => {
    for (const id of lost) {
      const entry = find(side, id);
      if (!entry) {
        continue;
      }
      const theirs = find(other, id);
      entry.cover =
        theirs && !otherLost.has(id)
          ? theirs.cover
          : otherLost.has(id)
          ? null
          : find(base, id)?.cover ?? null;
    }
  };
  fill(local, remote, lostLocal, lostRemote);
  fill(remote, local, lostRemote, lostLocal);
}
export type Choice = 'local' | 'remote';

/** JSON with sorted keys, so equal values compare equal whatever their key order. */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v as Record<string, unknown>)
            .sort()
            .map(k => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  );
}
const same = (a: unknown, b: unknown): boolean => stable(a) === stable(b);

type Pick3<T> = { value: T; conflict: boolean };
/** Nothing there: no value, an empty text or an empty list. */
const isEmpty = (v: unknown): boolean =>
  v === null ||
  v === undefined ||
  (typeof v === 'string' && !v.trim()) ||
  (Array.isArray(v) && !v.length);

/**
 * The three-way rule for one value, except that emptying is never carried
 * across: a value one side cleared keeps the other side's value.
 */
function pick<T>(base: T | undefined, local: T, remote: T): Pick3<T> {
  if (isEmpty(local) !== isEmpty(remote)) {
    return { value: isEmpty(local) ? remote : local, conflict: false };
  }
  if (same(local, remote) || same(base, remote)) {
    return { value: local, conflict: false };
  }
  if (same(base, local)) {
    return { value: remote, conflict: false };
  }
  return { value: local, conflict: true };
}

/** Set merge that only adds: everything either side has stays, local order first. */
export function union(...lists: string[][]): string[] {
  return [...new Set(lists.flat())];
}

function mergeMetadata(local: Metadata, remote: Metadata): Metadata {
  const result = { ...local };
  for (const group of METADATA_GROUPS) {
    result[group] = union(local[group], remote[group]);
  }
  return result;
}

function mergeEpisodes(
  base: Episode[] | undefined,
  local: Episode[],
  remote: Episode[],
  firstSync: boolean,
): Pick3<Episode[]> {
  const b = new Map((base ?? []).map(e => [e.id, e]));
  const l = new Map(local.map(e => [e.id, e]));
  const r = new Map(remote.map(e => [e.id, e]));
  let conflict = false;
  const result: Episode[] = [];
  for (const id of new Set([...l.keys(), ...r.keys()])) {
    const before = b.get(id),
      mine = l.get(id),
      theirs = r.get(id);
    if (!mine || !theirs) {
      const only = (mine ?? theirs)!;
      // Removed on one side and untouched on the other: removed. A removal on
      // one side against an edit on the other keeps the edited episode.
      if (before && same(before, only)) {
        continue;
      }
      result.push(only);
      continue;
    }
    if (firstSync && !before) {
      // No shared history: watched anywhere counts as watched.
      const merged = { ...mine, watched: mine.watched || theirs.watched };
      const rest = (e: Episode) => ({ ...e, watched: false });
      conflict ||= !same(rest(mine), rest(theirs));
      result.push(merged);
      continue;
    }
    const episode = { ...mine };
    for (const key of Object.keys({
      ...mine,
      ...theirs,
    }) as (keyof Episode)[]) {
      const field = pick(before?.[key], mine[key], theirs[key]);
      (episode as Record<string, unknown>)[key] = field.value;
      conflict ||= field.conflict;
    }
    result.push(episode);
  }
  return {
    value: result.sort((x, y) => x.number - y.number),
    conflict,
  };
}

const latest = (a: string | null, b: string | null): string | null =>
  !a ? b : !b ? a : a > b ? a : b;

/** Merges one title present on both sides. */
function mergeEntry(
  base: Entry | undefined,
  local: Entry,
  remote: Entry,
  firstSync: boolean,
): Pick3<Entry> {
  if (same(local, remote)) {
    return { value: local, conflict: false };
  }
  let conflict = false;
  const entry = { ...local };
  for (const key of Object.keys({ ...local, ...remote }) as (keyof Entry)[]) {
    if (key === 'episodes' || key === 'metadata' || key === 'watched') {
      continue;
    }
    // Last played time only moves forward; it is never a disagreement.
    if (key === 'lastWatchedAt') {
      entry.lastWatchedAt = latest(local.lastWatchedAt, remote.lastWatchedAt);
      continue;
    }
    if (firstSync && !base) {
      if (key === 'bookmarked' || key === 'read') {
        entry[key] = local[key] || remote[key];
        continue;
      }
      // Device-only details never count as a disagreement.
      if (key === 'legacy' || key === 'cover') {
        if (key === 'cover' && !local.cover) {
          entry.cover = remote.cover;
        }
        continue;
      }
      // Filled on one side only is not a disagreement: keep what is there.
      if (isEmpty(local[key]) !== isEmpty(remote[key])) {
        (entry as Record<string, unknown>)[key] = isEmpty(local[key])
          ? remote[key]
          : local[key];
        continue;
      }
      conflict ||= !same(local[key], remote[key]);
      continue;
    }
    const field = pick(base?.[key], local[key], remote[key]);
    (entry as Record<string, unknown>)[key] = field.value;
    conflict ||= field.conflict;
  }
  entry.metadata = mergeMetadata(local.metadata, remote.metadata);
  const episodes = mergeEpisodes(
    base?.episodes,
    local.episodes,
    remote.episodes,
    firstSync,
  );
  entry.episodes = episodes.value;
  conflict ||= episodes.conflict;
  // Titles without episodes (manga, custom) carry their own watched flag.
  if (!entry.episodes.length) {
    entry.watched =
      firstSync && !base
        ? local.watched || remote.watched
        : pick(base?.watched, local.watched, remote.watched).value;
  }
  return { value: entry, conflict };
}

export function mergeCatalogs(
  base: Catalog | null,
  local: Catalog,
  remote: Catalog,
): MergeResult {
  const firstSync = base === null;
  const conflicts: Conflict[] = [];
  const result = cloneCatalog(local);

  // Sections: by id, never removed; a disagreement keeps this device's version.
  const sectionIds = union(
    local.sections.map(s => s.id),
    remote.sections.map(s => s.id),
  );
  result.sections = sectionIds.map(id => {
    const mine = local.sections.find(s => s.id === id);
    const theirs = remote.sections.find(s => s.id === id);
    const before = base?.sections.find(s => s.id === id);
    return mine && theirs
      ? pick(before, mine, theirs).value
      : (mine ?? theirs)!;
  });

  // Titles.
  const b = new Map((base?.entries ?? []).map(e => [e.id, e]));
  const l = new Map(local.entries.map(e => [e.id, e]));
  const r = new Map(remote.entries.map(e => [e.id, e]));
  const entries: Entry[] = [];
  for (const id of new Set([...l.keys(), ...r.keys()])) {
    const before = b.get(id),
      mine = l.get(id),
      theirs = r.get(id);
    if (!mine || !theirs) {
      const only = (mine ?? theirs)!;
      // Deleted on one side and untouched on the other: deleted. Deleted against
      // edited keeps the edit, so nothing anyone changed is lost.
      if (before && same(before, only)) {
        continue;
      }
      entries.push(only);
      continue;
    }
    const merged = mergeEntry(before, mine, theirs, firstSync);
    entries.push(merged.value);
    if (merged.conflict) {
      conflicts.push({ id, title: mine.title, local: mine, remote: theirs });
    }
  }
  result.entries = entries;

  // Progress: newest wins; a position one side no longer has is kept. A
  // finished episode still drops its position, since it is watched.
  const progressIds = new Set([
    ...Object.keys(local.progress),
    ...Object.keys(remote.progress),
  ]);
  result.progress = {};
  for (const id of progressIds) {
    const mine = local.progress[id],
      theirs = remote.progress[id];
    result.progress[id] =
      mine && theirs
        ? mine.updatedAt >= theirs.updatedAt
          ? mine
          : theirs
        : (mine ?? theirs)!;
  }

  // Queue: order from whichever side changed it, keeping everything either
  // side queued (a deleted title still leaves it).
  const queue = pick(base?.queue, local.queue, remote.queue);
  result.queue = union(
    queue.conflict ? local.queue : queue.value,
    local.queue,
    remote.queue,
  );

  // Relation groups by id with members from both sides; blocked pairs as a set.
  result.relations = union(
    local.relations.map(x => x.id),
    remote.relations.map(x => x.id),
  ).map(id => {
    const mine = local.relations.find(x => x.id === id);
    const theirs = remote.relations.find(x => x.id === id);
    if (!mine || !theirs) {
      return (mine ?? theirs)!;
    }
    const before = base?.relations.find(x => x.id === id);
    return {
      ...mine,
      mode: pick(before?.mode, mine.mode, theirs.mode).value,
      entryIds: union(mine.entryIds, theirs.entryIds),
    };
  });
  const pairKey = (p: [string, string]) => [...p].sort().join('|');
  const pairs = new Map(
    [...local.blockedPairs, ...remote.blockedPairs].map(p => [pairKey(p), p]),
  );
  result.blockedPairs = union(
    local.blockedPairs.map(pairKey),
    remote.blockedPairs.map(pairKey),
  ).map(key => pairs.get(key)!);

  normalize(result);
  result.parentRevision = local.revision;
  result.revision = newId('revision');
  result.updatedAt = new Date().toISOString();
  return {
    catalog: result,
    conflicts,
    changes: {
      toLocal: describeChanges(local, result),
      toRemote: describeChanges(remote, result),
    },
  };
}

/** Settles conflicts: each listed title takes the chosen side's whole version. */
export function resolveConflicts(
  merged: Catalog,
  conflicts: Conflict[],
  choices: Record<string, Choice>,
): Catalog {
  const result = cloneCatalog(merged);
  for (const conflict of conflicts) {
    const chosen =
      choices[conflict.id] === 'remote' ? conflict.remote : conflict.local;
    result.entries = result.entries.map(e =>
      e.id === conflict.id ? JSON.parse(JSON.stringify(chosen)) : e,
    );
  }
  normalize(result);
  return result;
}

/**
 * What makes two titles the same one, whatever their ids: the same media folder,
 * or the same MyAnimeList id and season, in the same section. Both devices adding
 * a title on their own gives it two ids, and a merge by id alone keeps both.
 */
function identityKeys(e: Entry): string[] {
  const keys: string[] = [];
  const folder = e.relativeFolder.trim().replace(/\\/g, '/').toLowerCase();
  if (folder) {
    keys.push(`${e.sectionId}|folder|${folder}`);
  }
  if (e.external?.malId) {
    keys.push(
      `${e.sectionId}|mal|${e.external.malId}|${e.season.trim().toLowerCase()}`,
    );
  }
  return keys;
}

/**
 * Folds duplicate titles into the first one: watched anywhere stays watched,
 * labels and episodes from either copy are kept, and progress, the queue and
 * relations follow the kept id.
 */
export function foldDuplicates(c: Catalog): void {
  const seen = new Set<string>();
  const hasDuplicates = c.entries.some(e =>
    identityKeys(e).reduce(
      (dup, k) => seen.has(k) || !seen.add(k) || dup,
      false,
    ),
  );
  if (!hasDuplicates) {
    return;
  }
  // Merged entries can still be either side's own objects; never edit those.
  c.entries = JSON.parse(JSON.stringify(c.entries)) as Entry[];
  const owner = new Map<string, Entry>();
  const renamed = new Map<string, string>();
  const episodeRenamed = new Map<string, string>();
  const kept: Entry[] = [];
  for (const entry of c.entries) {
    const keys = identityKeys(entry);
    const keep = keys.map(k => owner.get(k)).find(Boolean);
    if (!keep || keep.kind !== entry.kind) {
      keys.forEach(k => owner.has(k) || owner.set(k, entry));
      kept.push(entry);
      continue;
    }
    keys.forEach(k => owner.has(k) || owner.set(k, keep));
    renamed.set(entry.id, keep.id);
    keep.bookmarked ||= entry.bookmarked;
    keep.read ||= entry.read;
    keep.watched ||= entry.watched;
    keep.cover ??= entry.cover;
    keep.rating ??= entry.rating;
    keep.lastWatchedAt = latest(keep.lastWatchedAt, entry.lastWatchedAt);
    keep.notes ||= entry.notes;
    keep.external ??= entry.external;
    keep.metadata = mergeMetadata(keep.metadata, entry.metadata);
    for (const episode of entry.episodes) {
      const match = keep.episodes.find(ep => ep.number === episode.number);
      if (match) {
        match.watched ||= episode.watched;
        episodeRenamed.set(episode.id, match.id);
      } else {
        keep.episodes.push(episode);
      }
    }
    keep.episodes.sort((x, y) => x.number - y.number);
  }
  if (!renamed.size) {
    return;
  }
  c.entries = kept;
  const progress: Catalog['progress'] = {};
  for (const p of Object.values(c.progress)) {
    const moved = {
      ...p,
      entryId: renamed.get(p.entryId) ?? p.entryId,
      episodeId: episodeRenamed.get(p.episodeId) ?? p.episodeId,
    };
    const other = progress[moved.episodeId];
    if (!other || moved.updatedAt > other.updatedAt) {
      progress[moved.episodeId] = moved;
    }
  }
  c.progress = progress;
  const rename = (id: string) => renamed.get(id) ?? id;
  c.queue = c.queue.map(rename);
  c.relations = c.relations.map(r => ({
    ...r,
    entryIds: r.entryIds.map(rename),
  }));
  c.blockedPairs = c.blockedPairs.map(
    ([left, right]) => [rename(left), rename(right)] as [string, string],
  );
}

/** Restores the catalog's own rules after merging two histories. */
export function normalize(c: Catalog): void {
  const sectionKinds = new Map(c.sections.map(s => [s.id, s.kind]));
  c.entries = c.entries.filter(e => sectionKinds.get(e.sectionId) === e.kind);
  foldDuplicates(c);
  for (const entry of c.entries) {
    // Two devices adding the same episode number keeps the first one.
    const numbers = new Set<number>();
    entry.episodes = entry.episodes.filter(ep => {
      if (numbers.has(ep.number)) {
        return false;
      }
      numbers.add(ep.number);
      return true;
    });
    if (entry.kind !== 'anime') {
      entry.episodes = [];
    }
    if (entry.episodes.length) {
      entry.watched = entry.episodes.every(ep => ep.watched);
    }
  }
  const entries = new Map(c.entries.map(e => [e.id, e]));
  const episodeOwner = new Map(
    c.entries.flatMap(e => e.episodes.map(ep => [ep.id, e] as const)),
  );
  for (const [key, p] of Object.entries(c.progress)) {
    const owner = episodeOwner.get(key);
    const episode = owner?.episodes.find(ep => ep.id === key);
    if (
      !owner ||
      owner.id !== p.entryId ||
      p.episodeId !== key ||
      episode?.watched
    ) {
      delete c.progress[key];
    }
  }
  const isAnime = (id: string) => entries.get(id)?.kind === 'anime';
  c.queue = [...new Set(c.queue)].filter(isAnime);
  const grouped = new Set<string>();
  c.relations = c.relations
    .map(relation => {
      const members = [...new Set(relation.entryIds)].filter(
        id => isAnime(id) && !grouped.has(id),
      );
      members.forEach(id => grouped.add(id));
      return { ...relation, entryIds: members };
    })
    .filter(relation => relation.entryIds.length >= 2);
  c.blockedPairs = c.blockedPairs.filter(
    ([left, right]) => left !== right && isAnime(left) && isAnime(right),
  );
}

/** "1, 2, 3, 5" as "1–3, 5". */
function ranges(numbers: number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) {
      j++;
    }
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  return parts.join(', ');
}
const episodes = (numbers: number[]) =>
  `${numbers.length === 1 ? 'Episode' : 'Episodes'} ${ranges(numbers)}`;
const clock = (seconds: number) => {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
};
const STATUS: Record<Entry['status'], string> = {
  Ongoing: 'Ongoing',
  Completed: 'Completed',
  Not_Aired: 'Not aired',
  Hiatus: 'Hiatus',
};

/** What changes about one title, in words, from `a` to `b`. */
function describeEntry(a: Entry, b: Entry): string[] {
  const out: string[] = [];
  if (a.title !== b.title) {
    out.push(`Renamed from "${a.title}"`);
  }
  if (a.sectionId !== b.sectionId) {
    out.push('Moved to another section');
  }
  if (a.season !== b.season) {
    out.push(`Season: ${a.season || 'none'} → ${b.season || 'none'}`);
  }
  if (a.status !== b.status) {
    out.push(`Status: ${STATUS[a.status]} → ${STATUS[b.status]}`);
  }
  if (a.bookmarked !== b.bookmarked) {
    out.push(b.bookmarked ? 'Bookmarked' : 'Bookmark removed');
  }
  if (a.read !== b.read) {
    out.push(b.read ? 'Marked read' : 'Marked unread');
  }
  if (!b.episodes.length && a.watched !== b.watched) {
    out.push(b.watched ? 'Marked watched' : 'Marked unwatched');
  }
  if (a.cover !== b.cover) {
    out.push(
      !b.cover ? 'Cover removed' : !a.cover ? 'Cover added' : 'New cover',
    );
  }
  if (a.link !== b.link) {
    out.push('Link changed');
  }
  if (a.rating !== b.rating) {
    out.push(b.rating ? `Rated ${b.rating}/10` : 'Rating removed');
  }
  if (a.notes !== b.notes) {
    out.push(b.notes ? 'Notes changed' : 'Notes removed');
  }
  if (!same(a.external, b.external)) {
    out.push('MyAnimeList match updated');
  }
  if (a.relativeFolder !== b.relativeFolder) {
    out.push('Media folder changed');
  }
  const labels: string[] = [];
  for (const group of METADATA_GROUPS) {
    labels.push(
      ...b.metadata[group]
        .filter(v => !a.metadata[group].includes(v))
        .map(v => `+${v}`),
      ...a.metadata[group]
        .filter(v => !b.metadata[group].includes(v))
        .map(v => `−${v}`),
    );
  }
  if (labels.length) {
    out.push(`Labels: ${labels.join(', ')}`);
  }
  const before = new Map(a.episodes.map(ep => [ep.number, ep]));
  const after = new Map(b.episodes.map(ep => [ep.number, ep]));
  const watched: number[] = [];
  const unwatched: number[] = [];
  const added: number[] = [];
  const edited: number[] = [];
  for (const [n, ep] of after) {
    const old = before.get(n);
    if (!old) {
      added.push(n);
      continue;
    }
    if (old.watched !== ep.watched) {
      (ep.watched ? watched : unwatched).push(n);
    }
    if (old.title !== ep.title || old.relativeFile !== ep.relativeFile) {
      edited.push(n);
    }
  }
  const removed = [...before.keys()].filter(n => !after.has(n));
  if (watched.length) out.push(`${episodes(watched)} watched`);
  if (unwatched.length) out.push(`${episodes(unwatched)} marked unwatched`);
  if (added.length) out.push(`${episodes(added)} added`);
  if (removed.length) out.push(`${episodes(removed)} removed`);
  if (edited.length) out.push(`${episodes(edited)} renamed or relinked`);
  return out.length ? out : ['Other details updated'];
}

/** Everything that changes on the side that holds `from`, title by title. */
export function describeChanges(from: Catalog, to: Catalog): Change[] {
  const changes = new Map<string, Change>();
  const add = (
    key: string,
    title: string,
    kind: Change['kind'],
    details: string[],
  ) => {
    const known = changes.get(key);
    if (known) {
      known.details.push(...details);
    } else {
      changes.set(key, { key, title, kind, details });
    }
  };
  const before = new Map(from.entries.map(e => [e.id, e]));
  const after = new Map(to.entries.map(e => [e.id, e]));
  const label = (e: Entry) => (e.season ? `${e.title} (${e.season})` : e.title);
  for (const entry of to.entries) {
    const old = before.get(entry.id);
    if (!old) {
      add(entry.id, label(entry), 'added', []);
    } else if (stable(old) !== stable(entry)) {
      add(entry.id, label(entry), 'changed', describeEntry(old, entry));
    }
  }
  for (const entry of from.entries) {
    if (!after.has(entry.id)) {
      add(entry.id, label(entry), 'removed', []);
    }
  }
  const named = (id: string) => {
    const e = after.get(id) ?? before.get(id);
    return e ? label(e) : 'A removed title';
  };
  const number = (entryId: string, episodeId: string) =>
    (after.get(entryId) ?? before.get(entryId))?.episodes.find(
      ep => ep.id === episodeId,
    )?.number;
  for (const key of new Set([
    ...Object.keys(from.progress),
    ...Object.keys(to.progress),
  ])) {
    const old = from.progress[key];
    const now = to.progress[key];
    if (same(old, now)) {
      continue;
    }
    const p = (now ?? old)!;
    if (now && !after.has(now.entryId)) {
      continue;
    }
    const ep = number(p.entryId, p.episodeId);
    const where = ep ? `Episode ${ep}` : 'An episode';
    add(p.entryId, named(p.entryId), 'changed', [
      now
        ? `Resume point: ${where} at ${clock(now.currentTime)}`
        : `Resume point for ${where} cleared`,
    ]);
  }
  if (!same(from.queue, to.queue)) {
    const gained = to.queue.filter(id => !from.queue.includes(id));
    const lost = from.queue.filter(id => !to.queue.includes(id));
    const details = [
      ...gained.map(id => `+ ${named(id)}`),
      ...lost.map(id => `− ${named(id)}`),
    ];
    add('queue', 'Queue', 'changed', details.length ? details : ['New order']);
  }
  if (
    !same(from.relations, to.relations) ||
    !same(from.blockedPairs, to.blockedPairs)
  ) {
    add('relations', 'Related titles', 'changed', ['Groups updated']);
  }
  if (!same(from.sections, to.sections)) {
    add('sections', 'Sections', 'changed', ['Sections updated']);
  }
  // Titles first, then the lists.
  return [...changes.values()];
}
