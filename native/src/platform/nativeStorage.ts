/* eslint-disable no-bitwise -- Base64 encoding uses byte-level masks and shifts. */
import { NativeModules } from 'react-native';
import { FileEntry, StorageAdapter } from './contracts';

type NativeStorage = {
  execute(method: string, payload: string): Promise<string>;
};
const alphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0,
      b = bytes[i + 1] ?? 0,
      c = bytes[i + 2] ?? 0;
    out +=
      alphabet[a >> 2]! +
      alphabet[((a & 3) << 4) | (b >> 4)]! +
      (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < bytes.length ? alphabet[c & 63] : '=');
  }
  return out;
}
export function decodeBase64(text: string): Uint8Array {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      text,
    )
  ) {
    throw new Error('Invalid native byte response');
  }
  const bytes = new Uint8Array(
    (text.length / 4) * 3 -
      (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0),
  );
  let n = 0;
  for (let i = 0; i < text.length; i += 4) {
    const a = alphabet.indexOf(text[i]!),
      b = alphabet.indexOf(text[i + 1]!),
      c = alphabet.indexOf(text[i + 2]!),
      d = alphabet.indexOf(text[i + 3]!);
    if (n < bytes.length) {
      bytes[n++] = (a << 2) | (b >> 4);
    }
    if (n < bytes.length) {
      bytes[n++] = ((b & 15) << 4) | (c >> 2);
    }
    if (n < bytes.length) {
      bytes[n++] = ((c & 3) << 6) | d;
    }
  }
  return bytes;
}
export async function createNativeStorage(): Promise<StorageAdapter> {
  const native = NativeModules.CatalogStorage as NativeStorage | undefined;
  if (!native) {
    throw new Error(
      'The native storage module is unavailable in this host. Install a complete native build.',
    );
  }
  async function call<T>(
    method: string,
    payload: Record<string, unknown> = {},
  ): Promise<T> {
    return JSON.parse(
      await native!.execute(method, JSON.stringify(payload)),
    ) as T;
  }
  const info = await call<{ privateRoot: string; initialMedia?: string }>(
    'info',
  );
  return {
    privateRoot: info.privateRoot,
    initialMedia: info.initialMedia ?? null,
    readText: path => call<string>('readText', { path }),
    writeText: async (path, value) => {
      await call('writeText', { path, value });
    },
    readBytes: async uri =>
      decodeBase64(await call<string>('readBytes', { uri })),
    writeBytes: async (uri, bytes) => {
      await call('writeBytes', { uri, value: encodeBase64(bytes) });
    },
    exists: uri => call<boolean>('exists', { uri }),
    list: uri => call<FileEntry[]>('list', { uri }),
    mkdir: async uri => {
      await call('mkdir', { uri });
    },
    replace: async (staged, destination) => {
      await call('replace', { staged, destination });
    },
    removeOwned: async uri => {
      await call('removeOwned', { uri });
    },
    pickFolder: () => call<string | null>('pickFolder'),
    pickFiles: kind => call<string[]>('pickFiles', { kind }),
    saveFile: (name, bytes) =>
      call<string | null>('saveFile', { name, value: encodeBase64(bytes) }),
    resolveChild: (root, relativePath) =>
      call<string | null>('resolveChild', { root, relativePath }),
    deleteMediaFolder: async (root, relativePath) => {
      await call('deleteMediaFolder', { root, relativePath });
    },
    thumbnail: async (source, destination, width) => {
      await call('thumbnail', { source, destination, width });
    },
    reveal: async uri => {
      await call('reveal', { uri });
    },
  };
}
