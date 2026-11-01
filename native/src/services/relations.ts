import { Catalog, Entry, Relation, newId } from '../domain/catalog';
export const normalizeRelationTitle = (value: string): string =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
// Matching-block similarity, like the legacy SequenceMatcher (titles normally <200 chars).
function matching(left: string, right: string): number {
  if (!left.length || !right.length) {
    return 0;
  }
  let best = 0,
    li = 0,
    ri = 0;
  let previous = new Array<number>(right.length + 1).fill(0);
  for (let a = 0; a < left.length; a++) {
    const row = new Array<number>(right.length + 1).fill(0);
    for (let b = 0; b < right.length; b++) {
      if (left[a] === right[b]) {
        row[b + 1] = (previous[b] ?? 0) + 1;
        if (row[b + 1]! > best) {
          best = row[b + 1]!;
          li = a - best + 1;
          ri = b - best + 1;
        }
      }
    }
    previous = row;
  }
  return best
    ? best +
        matching(left.slice(0, li), right.slice(0, ri)) +
        matching(left.slice(li + best), right.slice(ri + best))
    : 0;
}
export function related(left: string, right: string): boolean {
  const a = normalizeRelationTitle(left),
    b = normalizeRelationTitle(right);
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  if (Math.min(a.length, b.length) < 6) {
    return false;
  }
  const at = a.split(' '),
    bt = b.split(' '),
    as = new Set(at),
    bs = new Set(bt),
    union = new Set([...as, ...bs]);
  const overlap = [...as].filter(v => bs.has(v)).length / union.size;
  if ((2 * matching(a, b)) / (a.length + b.length) >= 0.9 && overlap >= 0.75) {
    return true;
  }
  const [short, long] = at.length <= bt.length ? [at, bt] : [bt, at];
  return (
    short.length >= 2 &&
    short.length / long.length >= 0.6 &&
    short.every((v, index) => v === long[index])
  );
}
function order(entry: Entry): [number, number, number, string] {
  const season = normalizeRelationTitle(entry.season),
    title = normalizeRelationTitle(entry.title);
  const match = /(?:^|\s)(?:s|season)\s*(\d+)(?:\D+(\d+))?/.exec(season);
  if (match) {
    return [0, Number(match[1]), Number(match[2] ?? 0), title];
  }
  const movie = /(?:movie|film)(?:\s*[-_]?\s*(\d+))?/.exec(season);
  if (movie) {
    return [2, Number(movie[1] ?? 1), 0, title];
  }
  if (
    ['ova', 'ona', 'special', 'sns', 'voc', 'extra'].some(v =>
      season.includes(v),
    )
  ) {
    return [1, Number(/\d+/.exec(season)?.[0] ?? 0), 0, title];
  }
  return [3, 0, 0, `${season} ${title}`];
}
export function defaultOrder(c: Catalog, ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const left = order(c.entries.find(e => e.id === a)!),
      right = order(c.entries.find(e => e.id === b)!);
    return (
      left[0] - right[0] ||
      left[1] - right[1] ||
      left[2] - right[2] ||
      left[3].localeCompare(right[3])
    );
  });
}
export const relationFor = (c: Catalog, id: string): Relation | undefined =>
  c.relations.find(r => r.entryIds.includes(id));
export function addRelation(
  c: Catalog,
  left: string,
  right: string,
  manual = true,
): void {
  if (
    left === right ||
    ![left, right].every(id =>
      c.entries.some(e => e.id === id && e.kind === 'anime'),
    )
  ) {
    throw new Error('Select two different local anime titles.');
  }
  const a = relationFor(c, left),
    b = relationFor(c, right);
  const aa = a?.entryIds ?? [left],
    bb = b?.entryIds ?? [right];
  if (manual) {
    c.blockedPairs = c.blockedPairs.filter(
      ([x, y]) =>
        !(
          (aa.includes(x) && bb.includes(y)) ||
          (aa.includes(y) && bb.includes(x))
        ),
    );
  } else if (
    c.blockedPairs.some(pair => pair.includes(left) && pair.includes(right))
  ) {
    return;
  }
  if (a && a === b) {
    return;
  }
  const ids = [...new Set([...aa, ...bb])];
  const mode = a?.mode === 'custom' || b?.mode === 'custom' ? 'custom' : 'auto';
  c.relations = c.relations.filter(r => r !== a && r !== b);
  c.relations.push({
    id: a?.id ?? b?.id ?? newId('relation'),
    entryIds: mode === 'auto' ? defaultOrder(c, ids) : ids,
    mode,
  });
}
export function scanRelations(c: Catalog, entryId?: string): void {
  const entries = c.entries.filter(e => e.kind === 'anime');
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!,
        b = entries[j]!;
      if (entryId && a.id !== entryId && b.id !== entryId) {
        continue;
      }
      if (related(a.title, b.title)) {
        addRelation(c, a.id, b.id, false);
      }
    }
  }
}
export function removeRelation(
  c: Catalog,
  anchor: string,
  removed: string,
): void {
  const group = relationFor(c, anchor);
  if (!group || anchor === removed || !group.entryIds.includes(removed)) {
    throw new Error('Invalid relation removal');
  }
  const rest = group.entryIds.filter(id => id !== removed);
  for (const id of rest) {
    if (
      !c.blockedPairs.some(pair => pair.includes(id) && pair.includes(removed))
    ) {
      c.blockedPairs.push([id, removed]);
    }
  }
  group.entryIds = rest;
  c.relations = c.relations.filter(r => r.entryIds.length >= 2);
}
export function reorderRelation(
  c: Catalog,
  anchor: string,
  ids: string[] | null,
): void {
  const group = relationFor(c, anchor);
  if (!group) {
    throw new Error('No related group');
  }
  if (ids === null) {
    group.entryIds = defaultOrder(c, group.entryIds);
    group.mode = 'auto';
    return;
  }
  if (
    ids.length !== group.entryIds.length ||
    new Set(ids).size !== ids.length ||
    ids.some(id => !group.entryIds.includes(id))
  ) {
    throw new Error('Order must contain each related title once.');
  }
  group.entryIds = [...ids];
  group.mode = 'custom';
}
