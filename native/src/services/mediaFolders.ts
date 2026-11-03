import { DeviceSettings, Entry } from '../domain/catalog';
import { StorageAdapter } from '../platform/contracts';

// Matches setup_anime_folders.py secure_path_part, including reserved names.
export function securePathPart(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .split('\u0000')
    .join('-')
    .replace(/\s+/gu, ' ')
    .replace(/^[ .]+|[ .]+$/g, '');
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)
    ? `${cleaned}_`
    : cleaned;
}

export function animeFolder(entry: Entry): string {
  const title = securePathPart(entry.title);
  const season = securePathPart(entry.season);
  if (entry.kind !== 'anime' || !title || !season) {
    throw new Error(
      'An anime title and season are required to create folders.',
    );
  }
  return `${title}/${season}`;
}

export type FolderPreview = {
  root: string;
  existing: string[];
  missing: string[];
  skipped: string[];
};

export async function previewMediaFolders(
  entries: Entry[],
  root: string,
  io: StorageAdapter,
): Promise<FolderPreview> {
  const preview: FolderPreview = {
    root,
    existing: [],
    missing: [],
    skipped: [],
  };
  const folders = new Map<string, string>();
  for (const entry of entries.filter(e => e.kind === 'anime')) {
    try {
      const folder = animeFolder(entry);
      folders.set(folder.toLowerCase(), folder);
    } catch {
      preview.skipped.push(entry.title);
    }
  }
  const sorted = [...folders.values()].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );
  if (io.scanMediaFolders) {
    const scan = await io.scanMediaFolders(root, sorted);
    preview.existing = scan.existing;
    preview.missing = scan.missing;
    preview.skipped.push(...scan.skipped);
    return preview;
  }
  for (const folder of sorted) {
    const target = await io.resolveChild(root, folder);
    if (target) {
      // Listing also rejects a regular file occupying the expected folder.
      await io.list(target);
      preview.existing.push(folder);
    } else {
      preview.missing.push(folder);
    }
  }
  return preview;
}

export async function createMissingMediaFolders(
  preview: FolderPreview,
  io: StorageAdapter,
): Promise<number> {
  if (io.createMediaFolders) {
    const result = await io.createMediaFolders(preview.root, preview.missing);
    if (result.failed.length) {
      const first = result.failed[0]!;
      throw new Error(
        `${result.created} folders created; ${result.failed.length} could not be created (first: ${first.folder}, ${first.error}). Preview again to retry them.`,
      );
    }
    return result.created;
  }
  let created = 0;
  for (const folder of preview.missing) {
    try {
      await io.createMediaFolder(preview.root, folder);
      created++;
    } catch (error) {
      throw new Error(
        `${created} folders completed; could not create ${folder}: ${String(
          error,
        )}. Preview again to retry.`,
      );
    }
  }
  return created;
}

export async function createEntryMediaFolder(
  entry: Entry,
  settings: DeviceSettings,
  io: StorageAdapter,
): Promise<string> {
  const root = settings.roots[entry.sectionId];
  if (!root) {
    return 'Entry added. No media folder is selected; choose one in Settings to create folders.';
  }
  await io.createMediaFolder(root, animeFolder(entry));
  return 'Entry added; title and season folder ready.';
}
