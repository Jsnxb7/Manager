import { z } from 'zod';

export const PAGE_SIZES = [10, 15, 20, 25, 50] as const;
export const METADATA_GROUPS = [
  'genres',
  'themes',
  'demographics',
  'tags',
] as const;
export type MetadataGroup = (typeof METADATA_GROUPS)[number];
const id = z.string().min(1).max(240);
const names = z.array(z.string().trim().min(1).max(300)).max(1000);
export const metadataSchema = z.object({
  genres: names,
  themes: names,
  demographics: names,
  tags: names,
});
export const episodeSchema = z.object({
  id,
  number: z.number().int().positive(),
  title: z.string().max(1000),
  watched: z.boolean(),
  relativeFile: z.string().max(4000),
  legacy: z.record(z.string(), z.unknown()).default({}),
});
export const entrySchema = z.object({
  id,
  sectionId: id,
  kind: z.enum(['anime', 'manga', 'custom']),
  title: z.string().trim().min(1).max(1000),
  season: z.string().max(300),
  status: z.enum(['Ongoing', 'Completed', 'Not_Aired', 'Hiatus']),
  link: z.string().max(8000),
  watched: z.boolean(),
  read: z.boolean(),
  bookmarked: z.boolean(),
  metadata: metadataSchema,
  episodes: z.array(episodeSchema).max(100000),
  relativeFolder: z.string().max(4000),
  cover: z.string().max(4000).nullable(),
  external: z
    .object({
      provider: z.literal('jikan'),
      malId: z.number().int().positive(),
      url: z.string(),
      fetchedAt: z.string(),
    })
    .nullable(),
  legacy: z.record(z.string(), z.unknown()).default({}),
});
export const progressSchema = z.object({
  entryId: id,
  episodeId: id,
  currentTime: z.number().finite().nonnegative(),
  duration: z.number().finite().nonnegative(),
  updatedAt: z.string(),
});
export const catalogSchema = z.object({
  schemaVersion: z.literal(2),
  id,
  revision: id,
  parentRevision: id.nullable(),
  updatedAt: z.string(),
  sections: z
    .array(
      z.object({
        id,
        title: z.string().min(1),
        kind: z.enum(['anime', 'manga', 'custom']),
      }),
    )
    .max(1000),
  entries: z.array(entrySchema).max(100000),
  progress: z.record(z.string(), progressSchema),
  queue: z.array(id).max(100000),
  relations: z.array(
    z.object({ id, entryIds: z.array(id), mode: z.enum(['auto', 'custom']) }),
  ),
  blockedPairs: z.array(z.tuple([id, id])),
  legacy: z.record(z.string(), z.unknown()).default({}),
});
export type Catalog = z.infer<typeof catalogSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type Episode = z.infer<typeof episodeSchema>;
export type Progress = z.infer<typeof progressSchema>;
export type Metadata = z.infer<typeof metadataSchema>;
export type Section = Catalog['sections'][number];
export type Relation = Catalog['relations'][number];

export const filterSchema = z.object({
  search: z.string(),
  unread: z.boolean(),
  ongoing: z.boolean(),
  bookmarked: z.boolean(),
  metadata: metadataSchema,
  page: z.number().int().positive(),
  pageSize: z.union([
    z.literal(10),
    z.literal(15),
    z.literal(20),
    z.literal(25),
    z.literal(50),
  ]),
});
export type LibraryFilter = z.infer<typeof filterSchema>;
export const settingsSchema = z.object({
  schemaVersion: z.literal(1),
  roots: z.record(z.string(), z.string()),
  titleFolders: z.record(z.string(), z.string()),
  episodeFiles: z.record(z.string(), z.string()),
  filters: z.record(z.string(), filterSchema),
  compact: z.record(z.string(), z.boolean()),
});
export type DeviceSettings = z.infer<typeof settingsSchema>;
export const emptyMetadata = (): Metadata => ({
  genres: [],
  themes: [],
  demographics: [],
  tags: [],
});
export const emptyFilter = (): LibraryFilter => ({
  search: '',
  unread: false,
  ongoing: false,
  bookmarked: false,
  metadata: emptyMetadata(),
  page: 1,
  pageSize: 15,
});
export const emptySettings = (): DeviceSettings => ({
  schemaVersion: 1,
  roots: {},
  titleFolders: {},
  episodeFiles: {},
  filters: {},
  compact: {},
});
let sequence = 0;
// Identity only, not a security token. Repository uniqueness validation is mandatory.
export const newId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(
    36,
  )}-${Math.random().toString(36).slice(2, 12)}`;
export function emptyCatalog(): Catalog {
  return {
    schemaVersion: 2,
    id: newId('catalog'),
    revision: newId('revision'),
    parentRevision: null,
    updatedAt: new Date().toISOString(),
    sections: [
      { id: 'anime', title: 'Anime', kind: 'anime' },
      { id: 'manga', title: 'Manga', kind: 'manga' },
    ],
    entries: [],
    progress: {},
    queue: [],
    relations: [],
    blockedPairs: [],
    legacy: {},
  };
}
export const cloneCatalog = (value: Catalog): Catalog =>
  JSON.parse(JSON.stringify(value)) as Catalog;

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Duplicate ${label}`);
  }
}
export function validateCatalog(raw: unknown): Catalog {
  const catalog = catalogSchema.parse(raw);
  unique(
    catalog.sections.map(s => s.id),
    'section identity',
  );
  unique(
    catalog.entries.map(e => e.id),
    'entry identity',
  );
  unique(
    catalog.entries.flatMap(e => e.episodes.map(ep => ep.id)),
    'episode identity',
  );
  unique(catalog.queue, 'queue entry');
  unique(
    catalog.relations.map(r => r.id),
    'relation identity',
  );
  const sections = new Map(catalog.sections.map(s => [s.id, s]));
  const entries = new Map(catalog.entries.map(e => [e.id, e]));
  const episodes = new Map(
    catalog.entries.flatMap(e => e.episodes.map(ep => [ep.id, e.id] as const)),
  );
  for (const entry of catalog.entries) {
    if (sections.get(entry.sectionId)?.kind !== entry.kind) {
      throw new Error('Invalid entry section');
    }
    unique(
      entry.episodes.map(ep => String(ep.number)),
      'episode number',
    );
    if (entry.kind !== 'anime' && entry.episodes.length) {
      throw new Error('Only anime has episode records');
    }
    if (
      entry.episodes.length &&
      entry.watched !== entry.episodes.every(ep => ep.watched)
    ) {
      throw new Error('Inconsistent watched state');
    }
  }
  for (const [key, p] of Object.entries(catalog.progress)) {
    if (key !== p.episodeId || episodes.get(key) !== p.entryId) {
      throw new Error('Orphan playback progress');
    }
    const ep = entries.get(p.entryId)?.episodes.find(e => e.id === key);
    if (ep?.watched) {
      throw new Error('Completed episode has active continuation');
    }
  }
  if (catalog.queue.some(key => entries.get(key)?.kind !== 'anime')) {
    throw new Error('Orphan queue title');
  }
  const grouped = new Set<string>();
  for (const relation of catalog.relations) {
    unique(relation.entryIds, 'relation member');
    if (relation.entryIds.length < 2) {
      throw new Error('Relation needs two titles');
    }
    for (const key of relation.entryIds) {
      if (entries.get(key)?.kind !== 'anime' || grouped.has(key)) {
        throw new Error('Invalid relation membership');
      }
      grouped.add(key);
    }
  }
  for (const [left, right] of catalog.blockedPairs) {
    if (
      left === right ||
      entries.get(left)?.kind !== 'anime' ||
      entries.get(right)?.kind !== 'anime'
    ) {
      throw new Error('Invalid blocked relation');
    }
  }
  return catalog;
}
