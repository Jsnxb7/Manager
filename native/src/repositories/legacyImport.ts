import {
  Catalog,
  Entry,
  Metadata,
  emptyCatalog,
  emptyMetadata,
  validateCatalog,
} from '../domain/catalog';

type RecordValue = Record<string, unknown>;
export type LegacyFiles = Record<string, unknown>;
export type MigrationResult = {
  catalog: Catalog;
  warnings: string[];
  artwork: { entryId: string; directories: string[]; title: string }[];
};
const object = (raw: unknown): RecordValue =>
  raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as RecordValue)
    : {};
const array = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : []);
const text = (raw: unknown, fallback = ''): string =>
  typeof raw === 'string' ? raw : fallback;
const number = (raw: unknown, fallback = 0): number =>
  Number.isFinite(Number(raw)) ? Number(raw) : fallback;
const cleanNames = (raw: unknown): string[] => [
  ...new Set(
    (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [])
      .map(v =>
        text(typeof v === 'object' ? object(v).name : v)
          .trim()
          .replace(/\s+/g, ' '),
      )
      .filter(Boolean),
  ),
];
function records(raw: unknown): RecordValue[] {
  if (Array.isArray(raw)) {
    return raw.map(object);
  }
  const value = object(raw);
  for (const key of ['data', 'items', 'manga', 'anime']) {
    if (Array.isArray(value[key])) {
      return array(value[key]).map(object);
    }
  }
  return Object.values(value)
    .filter(v => v !== null && typeof v === 'object' && !Array.isArray(v))
    .map(object);
}
function metadata(raw: RecordValue): Metadata {
  const result = emptyMetadata();
  for (const group of ['genres', 'themes', 'demographics', 'tags'] as const) {
    result[group] = cleanNames(raw[group]);
  }
  // Legacy manga headers may have been stored in a generic headers array.
  if (!Object.values(result).some(values => values.length)) {
    result.tags = cleanNames(raw.headers);
  }
  return result;
}
export function normalizeStatus(raw: unknown, anime = false): Entry['status'] {
  const value = text(raw).toLowerCase().replace(/[_-]/g, ' ');
  if (
    ['completed', 'complete', 'finished', 'finished airing'].includes(value)
  ) {
    return 'Completed';
  }
  if (!anime && ['hiatus', 'haitus', 'on hiatus'].includes(value)) {
    return 'Hiatus';
  }
  if (anime && ['not aired', 'not yet aired', 'unaired'].includes(value)) {
    return 'Not_Aired';
  }
  return 'Ongoing';
}
function basename(raw: string): string {
  return raw.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
}
export function safeRelative(raw: string): string {
  const normalized = raw.replace(/\\/g, '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized) ||
    normalized
      .split('/')
      .some(
        part =>
          !part ||
          part === '.' ||
          part === '..' ||
          part.includes(':') ||
          Array.from(part).some(character => character.charCodeAt(0) < 32),
      )
  ) {
    throw new Error('Invalid relative file reference');
  }
  return normalized;
}
function retained(raw: RecordValue): RecordValue {
  const result = { ...raw };
  for (const key of [
    'directory',
    'folder_path',
    'path',
    'file_path',
    'episode_video_path',
    'episodes',
    'thumbnail_url',
  ]) {
    delete result[key];
  }
  return result;
}
export function migrateLegacy(
  files: LegacyFiles,
  catalogId?: string,
): MigrationResult {
  const catalog = emptyCatalog();
  if (catalogId) {
    catalog.id = catalogId;
  }
  const warnings: string[] = [];
  const artwork: MigrationResult['artwork'] = [];
  const legacyAnime = new Map<string, Entry>();
  const rawSections = object(files['sections.json']).sections;
  const sections = [
    ...new Set(
      array(rawSections)
        .map(v => text(v).trim())
        .filter(Boolean),
    ),
  ];
  for (const name of sections) {
    const slug = name.toLowerCase().replace(/\s+/g, '_');
    if (['anime', 'manga'].includes(slug)) {
      continue;
    }
    if (!/^[\p{L}\p{N}_-]+$/u.test(slug)) {
      warnings.push(`Skipped unsafe section name: ${name}`);
      continue;
    }
    catalog.sections.push({ id: slug, title: name, kind: 'custom' });
  }
  const seen = new Set<string>();
  for (const section of catalog.sections) {
    const filename =
      section.kind === 'anime'
        ? 'anime_data.json'
        : section.kind === 'manga'
        ? 'manga_data.json'
        : `${section.id}_data.json`;
    let fallback = 0;
    for (const raw of records(files[filename])) {
      const title = text(raw.title, text(raw.name)).trim();
      if (!title) {
        warnings.push(`Skipped untitled record in ${filename}`);
        continue;
      }
      const oldId = String(raw.id ?? ++fallback);
      const id = `${section.id}:${oldId}`;
      if (seen.has(id)) {
        throw new Error(
          `Duplicate legacy identity ${id}; repair the source before import.`,
        );
      }
      seen.add(id);
      const season = text(raw.season, 'S1');
      const oldDirectory = text(
        raw.directory,
        text(raw.folder_path, text(raw.path)),
      ).replace(/\\/g, '/');
      let relativeFolder = '';
      if (section.kind === 'anime') {
        const proposed =
          text(raw.library_relative_directory) ||
          oldDirectory.split('/').filter(Boolean).slice(-2).join('/') ||
          `${title}/${season}`;
        try {
          relativeFolder = safeRelative(proposed);
        } catch {
          warnings.push(
            `Relink folder for ${title}; legacy folder could not be normalized.`,
          );
        }
      }
      const episodes = array(raw.episodes).map((value, index) => {
        const ep = object(value);
        const epNumber = Math.max(1, Math.trunc(number(ep.number, index + 1)));
        const oldFile = text(ep.file_path).replace(/\\/g, '/');
        let relativeFile =
          oldDirectory && oldFile.startsWith(oldDirectory + '/')
            ? oldFile.slice(oldDirectory.length + 1)
            : basename(oldFile) || `${epNumber}.mp4`;
        try {
          relativeFile = safeRelative(relativeFile);
        } catch {
          relativeFile = `${epNumber}.mp4`;
          warnings.push(`Relink episode ${epNumber} of ${title}`);
        }
        return {
          id: `${id}:episode:${epNumber}`,
          number: epNumber,
          title: text(ep.title, `Episode ${epNumber}`),
          watched: raw.watched === true || ep.watched === true,
          relativeFile,
          legacy: retained(ep),
        };
      });
      if (
        raw.watched === true &&
        episodes.some(
          (_, index) => object(array(raw.episodes)[index]).watched !== true,
        )
      ) {
        warnings.push(`Reconciled whole-title watched state for ${title}.`);
      }
      const source = object(raw.external_source);
      const malId = Math.trunc(number(source.mal_id));
      const entry: Entry = {
        id,
        sectionId: section.id,
        kind: section.kind,
        title,
        season: section.kind === 'anime' ? season : '',
        status: normalizeStatus(raw.status, section.kind === 'anime'),
        link: text(raw.download_link, text(raw.link, text(raw.url))),
        watched:
          episodes.length > 0
            ? episodes.every(e => e.watched)
            : raw.watched === true,
        read: raw.read === true,
        bookmarked: raw.bookmarked === true,
        metadata: metadata(raw),
        episodes: section.kind === 'anime' ? episodes : [],
        relativeFolder,
        cover: null,
        external:
          source.provider === 'jikan' && malId > 0
            ? {
                provider: 'jikan',
                malId,
                url: text(source.url),
                fetchedAt: text(source.fetched_at),
              }
            : null,
        legacy: retained(raw),
      };
      catalog.entries.push(entry);
      artwork.push({
        entryId: id,
        title,
        directories: [`static/${section.id}_images`, `${section.id}_images`],
      });
      if (section.kind === 'anime') {
        legacyAnime.set(oldId, entry);
      }
    }
  }
  const tracking = object(files['anime_tracking.json']);
  for (const [oldId, value] of Object.entries(object(tracking.anime))) {
    const entry = legacyAnime.get(oldId);
    if (!entry) {
      continue;
    }
    for (const [key, rawProgress] of Object.entries(
      object(object(value).episodes),
    )) {
      const p = object(rawProgress);
      const ep = entry.episodes.find(
        e => e.number === number(p.episode_number, number(key)),
      );
      if (!ep) {
        continue;
      }
      const duration = Math.max(0, number(p.total_duration));
      const time = Math.max(
        0,
        Math.min(number(p.current_time), duration || Number.MAX_SAFE_INTEGER),
      );
      if (p.completed === true || (duration > 0 && time / duration >= 0.9)) {
        ep.watched = true;
      } else if (!ep.watched && time > 1) {
        catalog.progress[ep.id] = {
          entryId: entry.id,
          episodeId: ep.id,
          currentTime: time,
          duration,
          updatedAt: text(p.last_watched_at, new Date().toISOString()),
        };
      }
    }
    if (entry.episodes.length) {
      entry.watched = entry.episodes.every(ep => ep.watched);
    }
  }
  for (const item of array(object(files['queue.json']).queue)) {
    const entry = legacyAnime.get(String(object(item).id));
    if (entry && !catalog.queue.includes(entry.id)) {
      catalog.queue.push(entry.id);
    }
  }
  const relations = object(files['anime_relations.json']);
  const members = new Set<string>();
  for (const value of array(relations.groups)) {
    const group = object(value);
    const ids = [
      ...new Set(
        array(group.ordered_anime_ids)
          .map(key => legacyAnime.get(String(key))?.id)
          .filter((key): key is string => Boolean(key)),
      ),
    ].filter(key => !members.has(key));
    if (ids.length < 2) {
      continue;
    }
    ids.forEach(key => members.add(key));
    catalog.relations.push({
      id: text(group.id, `relation-${catalog.relations.length + 1}`),
      entryIds: ids,
      mode: group.order_mode === 'custom' ? 'custom' : 'auto',
    });
  }
  for (const value of array(relations.blocked_pairs)) {
    const ids = array(object(value).anime_ids).map(
      key => legacyAnime.get(String(key))?.id,
    );
    const left = ids[0],
      right = ids[1];
    if (left && right && left !== right) {
      catalog.blockedPairs.push([left, right]);
    }
  }
  catalog.legacy = {
    uniqueAnimeTags: files['unique_anime_tags.json'] ?? null,
    uniqueMangaHeaders: files['unique_manga_headers.json'] ?? null,
  };
  return { catalog: validateCatalog(catalog), warnings, artwork };
}
