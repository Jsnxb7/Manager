import {
  Catalog,
  Entry,
  LibraryFilter,
  Metadata,
  METADATA_GROUPS,
  newId,
} from '../domain/catalog';
import { normalizeStatus, safeRelative } from '../repositories/legacyImport';
export type EntryDraft = {
  title: string;
  season: string;
  status: Entry['status'];
  link: string;
  episodeCount: number;
  metadata: Metadata;
  cover: string | null;
  external: Entry['external'];
};
export function cleanTitle(value: string): string {
  const clean = value
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '');
  if (!clean || Array.from(clean).some(c => c.charCodeAt(0) < 32)) {
    throw new Error('Enter a valid title.');
  }
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(clean)
    ? `${clean}_`
    : clean;
}
export function validLink(link: string): string {
  try {
    const url = new URL(link);
    if (!['https:', 'http:'].includes(url.protocol)) {
      throw new Error('scheme');
    }
    return link.trim();
  } catch {
    throw new Error('Enter a valid http or https source link.');
  }
}
export function createEntry(
  catalog: Catalog,
  sectionId: string,
  draft: EntryDraft,
): Entry {
  const section = catalog.sections.find(s => s.id === sectionId);
  if (!section) {
    throw new Error('Section not found');
  }
  const title = draft.title.trim();
  cleanTitle(title);
  validLink(draft.link);
  const compare = (v: string) => v.trim().toLowerCase();
  const duplicate = catalog.entries.some(
    e =>
      e.sectionId === sectionId &&
      compare(e.title) === compare(title) &&
      (section.kind === 'manga' ||
        (section.kind === 'anime' &&
          compare(e.season) === compare(draft.season) &&
          e.status === draft.status) ||
        (section.kind === 'custom' &&
          e.status === draft.status &&
          compare(e.link) === compare(draft.link))),
  );
  if (
    duplicate ||
    (draft.external &&
      catalog.entries.some(
        e =>
          e.kind === section.kind &&
          e.external?.malId === draft.external?.malId,
      ))
  ) {
    throw new Error('This entry already exists.');
  }
  if (
    section.kind !== 'custom' &&
    !METADATA_GROUPS.some(g => draft.metadata[g].length)
  ) {
    throw new Error('Select or add at least one metadata value.');
  }
  if (
    section.kind === 'anime' &&
    (!draft.season.trim() ||
      !Number.isInteger(draft.episodeCount) ||
      draft.episodeCount < 1 ||
      draft.episodeCount > 100000)
  ) {
    throw new Error('Enter a season and an episode count from 1 to 100,000.');
  }
  const id = newId(section.kind);
  const season = draft.season.trim();
  const entry: Entry = {
    id,
    sectionId,
    kind: section.kind,
    title,
    season: section.kind === 'anime' ? season : '',
    status: normalizeStatus(draft.status, section.kind === 'anime'),
    link: draft.link.trim(),
    watched: false,
    read: false,
    bookmarked: false,
    metadata: draft.metadata,
    cover: draft.cover,
    external: draft.external,
    relativeFolder:
      section.kind === 'anime'
        ? safeRelative(`${cleanTitle(title)}/${cleanTitle(season)}`)
        : '',
    legacy: {},
    episodes:
      section.kind === 'anime'
        ? Array.from({ length: draft.episodeCount }, (_, index) => ({
            id: newId('episode'),
            number: index + 1,
            title: `Episode ${index + 1}`,
            watched: false,
            relativeFile: `${index + 1}.mp4`,
            legacy: {},
          }))
        : [],
  };
  catalog.entries.push(entry);
  return entry;
}
export function filterEntries(
  entries: Entry[],
  filter: LibraryFilter,
): Entry[] {
  const query = filter.search.trim().toLowerCase();
  return entries
    .filter(e => {
      if (filter.unread && (e.kind === 'anime' ? e.watched : e.read)) {
        return false;
      }
      if (
        (filter.bookmarked && !e.bookmarked) ||
        (filter.ongoing && e.status !== 'Ongoing')
      ) {
        return false;
      }
      if (
        query &&
        ![
          e.title,
          e.season,
          e.status,
          e.link,
          ...Object.values(e.metadata).flat(),
        ].some(v => v.toLowerCase().includes(query))
      ) {
        return false;
      }
      return METADATA_GROUPS.every(
        group =>
          !filter.metadata[group].length ||
          filter.metadata[group].some(v =>
            e.metadata[group].some(
              value => value.toLowerCase() === v.toLowerCase(),
            ),
          ),
      );
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}
export function metadataCatalog(
  entries: Entry[],
): Record<keyof Metadata, { name: string; count: number }[]> {
  const result = {} as Record<
    keyof Metadata,
    { name: string; count: number }[]
  >;
  for (const group of METADATA_GROUPS) {
    const values = new Map<string, number>();
    for (const entry of entries) {
      for (const value of entry.metadata[group]) {
        values.set(value, (values.get(value) ?? 0) + 1);
      }
    }
    result[group] = [...values]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  return result;
}
export function watchedPercent(entry: Entry): number {
  return entry.episodes.length
    ? (entry.episodes.filter(e => e.watched).length / entry.episodes.length) *
        100
    : entry.watched
    ? 100
    : 0;
}
export function entryById(catalog: Catalog, id: string): Entry {
  const entry = catalog.entries.find(e => e.id === id);
  if (!entry) {
    throw new Error('Title no longer exists');
  }
  return entry;
}
