import { DeviceSettings, Entry, newId } from '../domain/catalog';
import { FileEntry, StorageAdapter } from '../platform/contracts';
import { safeRelative } from '../repositories/legacyImport';
import { FolderMatch, VIDEO_EXTENSION, matchFolder } from './episodeMatch';
export { episodeNumber } from './episodeMatch';

export type Availability =
  | {
      state: 'available';
      uri: string;
      /** File name and why it was chosen, for "Review matches". */
      name?: string;
      reason?: string;
    }
  | {
      state: 'missing' | 'unlinked' | 'permission' | 'ambiguous';
      message: string;
      /** The files that claim the episode, when ambiguous. */
      files?: string[];
    };

export type FolderScan = {
  availability: Record<string, Availability>;
  /** Null when the title has no readable folder. */
  folder: FolderMatch | null;
};

const baseName = (uri: string) => {
  const name = uri.slice(
    Math.max(uri.lastIndexOf('/'), uri.lastIndexOf('\\')) + 1,
  );
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
};

export class MediaResolver {
  constructor(private readonly io: StorageAdapter) {}
  async folder(entry: Entry, settings: DeviceSettings): Promise<string | null> {
    const override = settings.titleFolders[entry.id];
    if (override) {
      return override;
    }
    const root = settings.roots[entry.sectionId];
    return root && entry.relativeFolder
      ? this.io.resolveChild(root, safeRelative(entry.relativeFolder))
      : null;
  }
  async check(
    entry: Entry,
    settings: DeviceSettings,
  ): Promise<Record<string, Availability>> {
    return (await this.scan(entry, settings)).availability;
  }
  /** Availability of every episode plus what the folder holds beyond them. */
  async scan(entry: Entry, settings: DeviceSettings): Promise<FolderScan> {
    const availability: Record<string, Availability> = {};
    let folder: string | null;
    try {
      folder = await this.folder(entry, settings);
    } catch (error) {
      for (const ep of entry.episodes) {
        availability[ep.id] = { state: 'permission', message: String(error) };
      }
      return { availability, folder: null };
    }
    const scans = new Map<string, Promise<FileEntry[]>>();
    const list = (uri: string) => {
      let scan = scans.get(uri);
      if (!scan) {
        scan = this.io.list(uri);
        scans.set(uri, scan);
      }
      return scan;
    };
    const isVideo = (file: FileEntry) =>
      !file.directory && VIDEO_EXTENSION.test(file.name);
    const explicitVideo = async (uri: string) => {
      // Provider URIs are opaque: validate against the selected folder listing,
      // never manufacture a parent document URI from its encoded identifier.
      if (uri.startsWith('content://')) {
        return folder
          ? (await list(folder)).find(f => f.uri === uri && isVideo(f))
          : undefined;
      }
      const split = Math.max(uri.lastIndexOf('/'), uri.lastIndexOf('\\'));
      return split >= 0
        ? (await list(uri.slice(0, split))).find(
            f => f.uri === uri && isVideo(f),
          )
        : undefined;
    };
    const fixed: Record<string, { file: FileEntry; reason: string }> = {};
    // A file linked with Locate comes first, then the saved file name.
    await Promise.all(
      entry.episodes.map(async ep => {
        try {
          const explicit = settings.episodeFiles[ep.id];
          if (explicit && (await this.io.exists(explicit))) {
            const file = await explicitVideo(explicit);
            if (file) {
              fixed[ep.id] = { file, reason: 'Linked with Locate' };
              return;
            }
          }
          if (!folder) {
            return;
          }
          const relative = safeRelative(ep.relativeFile);
          const split = relative.lastIndexOf('/');
          const parent =
            split < 0
              ? folder
              : await this.io.resolveChild(folder, relative.slice(0, split));
          const direct =
            parent &&
            (await list(parent)).find(
              f => f.name === relative.slice(split + 1) && isVideo(f),
            );
          if (direct) {
            fixed[ep.id] = { file: direct, reason: 'Saved file name' };
          }
        } catch (error) {
          availability[ep.id] = { state: 'permission', message: String(error) };
        }
      }),
    );
    const settled = (id: string): Availability | undefined => {
      const found = fixed[id];
      return found
        ? {
            state: 'available',
            uri: found.file.uri,
            name: found.file.name || baseName(found.file.uri),
            reason: found.reason,
          }
        : undefined;
    };
    if (!folder) {
      for (const ep of entry.episodes) {
        availability[ep.id] ??= settled(ep.id) ?? {
          state: settings.roots[entry.sectionId] ? 'missing' : 'unlinked',
          message: 'Select or relink the local media folder.',
        };
      }
      return { availability, folder: null };
    }
    let videos: FileEntry[];
    try {
      videos = (await list(folder)).filter(isVideo);
    } catch (error) {
      for (const ep of entry.episodes) {
        availability[ep.id] ??= settled(ep.id) ?? {
          state: 'permission',
          message: String(error),
        };
      }
      return { availability, folder: null };
    }
    const match = matchFolder(entry, videos, fixed);
    for (const ep of entry.episodes) {
      if (availability[ep.id]) {
        continue;
      }
      const result = match.episodes[ep.id]!;
      availability[ep.id] =
        result.state === 'matched'
          ? {
              state: 'available',
              uri: result.file.uri,
              name: result.file.name,
              reason: result.reason,
            }
          : result.state === 'ambiguous'
          ? {
              state: 'ambiguous',
              files: result.files.map(f => f.name),
              message: `${result.files.length} files claim episode ${
                ep.number
              }: ${result.files
                .map(f => f.name)
                .join(', ')}. Use Locate to pick one.`,
            }
          : {
              state: 'missing',
              message: 'No matching episode file. Locate the file manually.',
            };
    }
    return { availability, folder: match };
  }
}
export async function importCover(
  io: StorageAdapter,
  source: string,
): Promise<string> {
  await io.mkdir(`${io.privateRoot}/artwork`);
  const name = `artwork/${newId('cover')}.webp`;
  try {
    await io.thumbnail(source, `${io.privateRoot}/${name}`, 640);
    return name;
  } catch (error) {
    const bytes = await io.readBytes(source);
    const extension =
      bytes[0] === 0x89 && bytes[1] === 0x50
        ? 'png'
        : bytes[0] === 0xff && bytes[1] === 0xd8
        ? 'jpg'
        : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
          String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
        ? 'webp'
        : String.fromCharCode(...bytes.slice(0, 3)) === 'GIF'
        ? 'gif'
        : null;
    if (!extension || bytes.length > 8 * 1024 * 1024) {
      throw new Error(
        `Cover could not be decoded or exceeds 8 MiB: ${String(error)}`,
      );
    }
    const fallback = `artwork/${newId('cover')}.${extension}`;
    await io.writeBytes(`${io.privateRoot}/${fallback}`, bytes);
    return fallback;
  }
}
