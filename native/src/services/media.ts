import { DeviceSettings, Entry, Episode, newId } from '../domain/catalog';
import { FileEntry, StorageAdapter } from '../platform/contracts';
import { safeRelative } from '../repositories/legacyImport';
export type Availability =
  | { state: 'available'; uri: string }
  | { state: 'missing' | 'unlinked' | 'permission'; message: string };
export function episodeNumber(filename: string): number | null {
  if (!/\.(mp4|mkv|avi|mov|webm|m4v|ogg)$/i.test(filename)) {
    return null;
  }
  const stem = filename.replace(/\.[^.]+$/, '');
  if (/^\d+$/.test(stem)) {
    return Number(stem);
  }
  const match =
    /(?:^|[\s._-])(?:s\d{1,2}e|episodes?|eps?|ep|e)?[\s._-]*(\d{1,4})(?:v\d+)?(?:[\s._-]*(?:end|final))?(?=[\s._-]|$)/i.exec(
      stem,
    );
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
    let listing: FileEntry[] | null = null;
    let scan: Promise<FileEntry[]> | null = null;
    const inspect = async (ep: Episode): Promise<void> => {
      try {
        const explicit = settings.episodeFiles[ep.id];
        if (explicit && (await this.io.exists(explicit))) {
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
        const direct = await this.io.resolveChild(
          folder,
          safeRelative(ep.relativeFile),
        );
        if (direct) {
          results[ep.id] = { state: 'available', uri: direct };
          return;
        }
        scan ??= this.io.list(folder);
        listing ??= await scan;
        const numbered = listing
          .filter(f => !f.directory && episodeNumber(f.name) !== null)
          .sort(
            (a, b) =>
              (episodeNumber(a.name) ?? 0) - (episodeNumber(b.name) ?? 0) ||
              a.name.localeCompare(b.name),
          );
        const exact = numbered.filter(f => episodeNumber(f.name) === ep.number);
        const startsAtOne = numbered.some(f => episodeNumber(f.name) === 1);
        const match =
          exact.length === 1
            ? exact[0]
            : !startsAtOne && numbered.length === entry.episodes.length
            ? numbered[ep.number - 1]
            : undefined;
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
