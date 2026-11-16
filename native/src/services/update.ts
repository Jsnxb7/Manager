import { StorageAdapter } from '../platform/contracts';
import { APP_BUILD } from '../app/version';

/**
 * In-app updates. `npm run release` (tools/release.cjs) builds both apps and
 * publishes them with an update.json to %LOCALAPPDATA%\AnimeManager\updates on the
 * PC. The PC app installs its installer from there; the phone gets the APK from
 * the PC over the sync connection.
 */
export type UpdateFile = { file: string; sha256: string; size: number };
export type UpdateManifest = {
  version: string;
  build: number;
  publishedAt: string;
  windows?: UpdateFile;
  android?: UpdateFile;
};
/** What the phone needs to know about the PC's update. */
export type OfferedUpdate = { version: string; build: number; size: number };

/** The updates folder sits beside the catalogs folder in the app's data. */
export function updatesFolder(privateRoot: string): string {
  return `${privateRoot.replace(/[\\/][^\\/]+[\\/]?$/, '')}/updates`;
}

export function isNewer(
  manifest: { build: number } | null | undefined,
): boolean {
  return (
    !!manifest && Number.isInteger(manifest.build) && manifest.build > APP_BUILD
  );
}

export async function readLocalUpdate(
  io: Pick<StorageAdapter, 'privateRoot' | 'exists' | 'readText'>,
): Promise<UpdateManifest | null> {
  const path = `${updatesFolder(io.privateRoot)}/update.json`;
  try {
    if (!(await io.exists(path))) {
      return null;
    }
    const raw = JSON.parse(await io.readText(path)) as UpdateManifest;
    return typeof raw.version === 'string' && Number.isInteger(raw.build)
      ? raw
      : null;
  } catch {
    return null;
  }
}

const SAFE_FILE = /^AnimeManager-[\w.-]+\.(exe|apk)$/;

/** The full path of an update file, after checking its name and content hash. */
export async function verifiedUpdateFile(
  io: Pick<StorageAdapter, 'privateRoot' | 'exists' | 'hashFiles'>,
  file: UpdateFile,
): Promise<string> {
  if (!SAFE_FILE.test(file.file)) {
    throw new Error('The update has an unexpected file name');
  }
  const path = `${updatesFolder(io.privateRoot)}/${file.file}`;
  if (!(await io.exists(path))) {
    throw new Error('The update file is missing; build the release again');
  }
  if (io.hashFiles) {
    const hashes = await io.hashFiles([path]);
    if (hashes[path] !== file.sha256) {
      throw new Error('The update file is damaged; build the release again');
    }
  }
  return path;
}
