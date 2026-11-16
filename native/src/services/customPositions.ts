import { StorageAdapter } from '../platform/contracts';

/** Where each Custom Player file was left, by file location. Device-only. */
export type SavedPositions = Record<
  string,
  { position: number; duration: number; updatedAt: string }
>;

const FILE = 'custom-player-positions.json';
const LIMIT = 200;

/**
 * Remembers a position. A file watched to 90% or its end is forgotten, so it
 * starts from the beginning next time; only the newest LIMIT files are kept.
 */
export function recordPosition(
  saved: SavedPositions,
  uri: string,
  position: number,
  duration: number,
  ended = false,
  now = new Date(),
): void {
  if (!Number.isFinite(position) || !Number.isFinite(duration)) {
    return;
  }
  if (ended || (duration > 0 && position / duration >= 0.9)) {
    delete saved[uri];
    return;
  }
  if (position < 5) {
    return;
  }
  saved[uri] = { position, duration, updatedAt: now.toISOString() };
  const keys = Object.keys(saved);
  if (keys.length > LIMIT) {
    keys
      .sort((a, b) => saved[a]!.updatedAt.localeCompare(saved[b]!.updatedAt))
      .slice(0, keys.length - LIMIT)
      .forEach(key => delete saved[key]);
  }
}

export async function loadPositions(
  io: Pick<StorageAdapter, 'privateRoot' | 'exists' | 'readText'>,
): Promise<SavedPositions> {
  const path = `${io.privateRoot}/${FILE}`;
  try {
    if (!(await io.exists(path))) {
      return {};
    }
    const raw = JSON.parse(await io.readText(path)) as unknown;
    const result: SavedPositions = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [uri, value] of Object.entries(raw)) {
        const v = value as Partial<SavedPositions[string]>;
        if (
          typeof v?.position === 'number' &&
          typeof v.duration === 'number' &&
          typeof v.updatedAt === 'string'
        ) {
          result[uri] = {
            position: v.position,
            duration: v.duration,
            updatedAt: v.updatedAt,
          };
        }
      }
    }
    return result;
  } catch {
    // A damaged file only loses resume points; start fresh rather than fail.
    return {};
  }
}

export async function savePositions(
  io: Pick<StorageAdapter, 'privateRoot' | 'writeText' | 'replace'>,
  saved: SavedPositions,
): Promise<void> {
  const staged = `${io.privateRoot}/${FILE}.staged`;
  await io.writeText(staged, JSON.stringify(saved));
  await io.replace(staged, `${io.privateRoot}/${FILE}`);
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}
