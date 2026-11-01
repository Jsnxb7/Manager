import { DeviceSettings, Entry, Episode, newId } from '../domain/catalog';
import { FileEntry, StorageAdapter } from '../platform/contracts';
import { safeRelative } from '../repositories/legacyImport';
export type Availability =
  | { state: 'available'; uri: string }
  | {
      state: 'missing' | 'unlinked' | 'permission' | 'ambiguous';
      message: string;
    };
const videoExtension = /\.(mp4|mkv|webm|avi|mov|m4v)$/i;
export function episodeNumber(filename: string): number | null {
  if (!videoExtension.test(filename)) {
    return null;
  }
  const stem = filename
    .replace(/\.[^.]+$/, '')
    .replace(/\b(?:\d{3,4}p|[xh]\.?26[45]|\d{1,2}bit)\b/gi, ' ');
  if (/^\d+$/.test(stem)) {
    return Number(stem);
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
    const results: Record<string, Availability> = {};
    let folder: string | null;
    try {
      folder = await this.folder(entry, settings);
    } catch (error) {
      for (const ep of entry.episodes) {
        results[ep.id] = { state: 'permission', message: String(error) };
      }
      return results;
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
      !file.directory && videoExtension.test(file.name);
    const explicitVideo = async (uri: string) => {
      // Provider URIs are opaque: validate against the selected folder listing,
      // never manufacture a parent document URI from its encoded identifier.
      if (uri.startsWith('content://')) {
        return (
          !!folder &&
          (await list(folder)).some(f => f.uri === uri && isVideo(f))
        );
      }
      const split = Math.max(uri.lastIndexOf('/'), uri.lastIndexOf('\\'));
      return (
        split >= 0 &&
        (await list(uri.slice(0, split))).some(f => f.uri === uri && isVideo(f))
      );
    };
    const inspect = async (ep: Episode): Promise<void> => {
      try {
        const explicit = settings.episodeFiles[ep.id];
        if (
          explicit &&
          (await this.io.exists(explicit)) &&
          (await explicitVideo(explicit))
        ) {
          results[ep.id] = { state: 'available', uri: explicit };
          return;
        }
        if (!folder) {
          results[ep.id] = {
            state: settings.roots[entry.sectionId] ? 'missing' : 'unlinked',
            message: 'Select or relink the local media folder.',
          };
          return;
        }
        const videos = (await list(folder)).filter(isVideo);
        const numbered = videos.filter(f => episodeNumber(f.name) !== null);
        const exact = numbered.filter(f => episodeNumber(f.name) === ep.number);
        if (exact.length > 1) {
          results[ep.id] = {
            state: 'ambiguous',
            message: `Multiple video files claim episode ${ep.number}. Use Locate to select the intended file, or move duplicate releases out of this folder.`,
          };
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
        const match =
          direct ||
          exact[0] ||
          (numbered.length === 0 && videos.length === entry.episodes.length
            ? [...videos].sort((a, b) => a.name.localeCompare(b.name))[
                ep.number - 1
              ]
            : undefined);
        results[ep.id] = match
          ? { state: 'available', uri: match.uri }
          : {
              state: 'missing',
              message: 'No matching episode file. Locate the file manually.',
            };
      } catch (error) {
        results[ep.id] = { state: 'permission', message: String(error) };
      }
    };
    for (let index = 0; index < entry.episodes.length; index += 8) {
      await Promise.all(entry.episodes.slice(index, index + 8).map(inspect));
    }
    return results;
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
