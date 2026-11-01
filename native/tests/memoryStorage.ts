import { strFromU8, strToU8 } from 'fflate';
import { StorageAdapter } from '../src/platform/contracts';
export function memoryStorage(privateRoot = 'app') {
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>([privateRoot]);
  const removed: string[] = [];
  let saved: Uint8Array | null = null;
  const io: StorageAdapter = {
    privateRoot,
    initialMedia: null,
    readText: async p => {
      const bytes = files.get(p);
      if (!bytes) {
        throw new Error('missing file');
      }
      return strFromU8(bytes);
    },
    readBytes: async p => {
      const bytes = files.get(p);
      if (!bytes) {
        throw new Error('missing file');
      }
      return new Uint8Array(bytes);
    },
    writeText: async (p, value) => {
      files.set(p, strToU8(value));
    },
    writeBytes: async (p, value) => {
      files.set(p, new Uint8Array(value));
    },
    exists: async p => files.has(p) || directories.has(p),
    mkdir: async p => {
      directories.add(p);
    },
    replace: async (a, b) => {
      const value = files.get(a);
      if (!value) {
        throw new Error('missing stage');
      }
      files.set(b, value);
      files.delete(a);
    },
    removeOwned: async p => {
      files.delete(p);
    },
    pickFolder: async () => null,
    pickFiles: async () => [],
    list: async p =>
      [...new Set([...files.keys(), ...directories])]
        .filter(
          name =>
            name.startsWith(p + '/') && !name.slice(p.length + 1).includes('/'),
        )
        .map(name => ({
          name: name.slice(p.length + 1),
          uri: name,
          directory: directories.has(name),
          size: files.get(name)?.length ?? 0,
        })),
    saveFile: async (_name, bytes) => {
      saved = bytes;
      return 'export.zip';
    },
    resolveChild: async (root, path) => {
      const value = root + '/' + path;
      return files.has(value) || directories.has(value) ? value : null;
    },
    deleteMediaFolder: async (root, path) => {
      removed.push(root + '/' + path);
    },
    thumbnail: async () => {
      throw new Error('No encoder');
    },
    reveal: async () => {},
  };
  return {
    io,
    files,
    directories,
    removed,
    getSaved: () => {
      if (!saved) {
        throw new Error('No export saved');
      }
      return saved;
    },
  };
}
