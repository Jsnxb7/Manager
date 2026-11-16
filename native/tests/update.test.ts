import { sha256 } from '@noble/hashes/sha256';
import { strToU8 } from 'fflate';
import { bytesToHex } from '@noble/hashes/utils';
import { emptyCatalog } from '../src/domain/catalog';
import { JsonRepository } from '../src/repositories/JsonRepository';
import { APP_BUILD } from '../src/app/version';
import {
  isNewer,
  readLocalUpdate,
  updatesFolder,
  verifiedUpdateFile,
} from '../src/services/update';
import { createHost } from '../src/services/sync/host';
import { hello } from '../src/services/sync/client';
import { signRequest } from '../src/services/sync/protocol';
import { memoryStorage } from './memoryStorage';

const KEY = '0123456789abcdef0123456789abcdef';

function setup() {
  const store = memoryStorage(
    'C:/Users/me/AppData/Local/AnimeManager/catalogs',
  );
  const apk = new Uint8Array([1, 2, 3, 4]);
  const folder = updatesFolder(store.io.privateRoot);
  store.files.set(`${folder}/AnimeManager-9.9.9.apk`, apk);
  const manifest = {
    version: '9.9.9',
    build: APP_BUILD + 1,
    publishedAt: '2026-11-06T00:00:00Z',
    android: {
      file: 'AnimeManager-9.9.9.apk',
      sha256: bytesToHex(sha256(apk)),
      size: apk.length,
    },
  };
  store.files.set(`${folder}/update.json`, strToU8(JSON.stringify(manifest)));
  // The in-memory store hashes like the native one does.
  store.io.hashFiles = async uris =>
    Object.fromEntries(
      uris
        .filter(u => store.files.has(u))
        .map(u => [u, bytesToHex(sha256(store.files.get(u)!))]),
    );
  return { store, folder, manifest, apk };
}

describe('app updates', () => {
  it('finds the updates folder beside the catalogs and compares builds', () => {
    expect(updatesFolder('C:/x/AnimeManager/catalogs')).toBe(
      'C:/x/AnimeManager/updates',
    );
    expect(isNewer({ build: APP_BUILD + 1 })).toBe(true);
    expect(isNewer({ build: APP_BUILD })).toBe(false);
    expect(isNewer(null)).toBe(false);
  });

  it('accepts only an intact update file with an expected name', async () => {
    const { store, manifest, folder } = setup();
    expect((await readLocalUpdate(store.io))?.version).toBe('9.9.9');
    await expect(verifiedUpdateFile(store.io, manifest.android)).resolves.toBe(
      `${folder}/AnimeManager-9.9.9.apk`,
    );
    store.files.set(`${folder}/AnimeManager-9.9.9.apk`, new Uint8Array([9]));
    await expect(
      verifiedUpdateFile(store.io, manifest.android),
    ).rejects.toThrow(/damaged/);
    await expect(
      verifiedUpdateFile(store.io, {
        ...manifest.android,
        file: '../evil.apk',
      }),
    ).rejects.toThrow(/file name/);
  });

  it('offers the APK in hello and hands the verified file to the native server', async () => {
    const { store, folder } = setup();
    const repo = new JsonRepository(
      store.io,
      `${store.io.privateRoot}/library`,
    );
    await repo.replaceCatalog(emptyCatalog(), (await repo.load()).revision);
    const host = createHost({
      key: () => KEY,
      repo: () => repo,
      io: () => store.io,
      onCommitted: () => undefined,
      update: () => readLocalUpdate(store.io),
    });
    const reply = await hello({ transport: r => host(r), key: KEY });
    expect(reply.update?.version).toBe('9.9.9');
    const apk = await host(signRequest(KEY, 'GET', '/sync/update/apk'));
    expect(apk).toEqual({
      status: 200,
      body: `@file:${folder}/AnimeManager-9.9.9.apk`,
    });
    const unsigned = await host({
      method: 'GET',
      path: '/sync/update/apk',
      body: '',
      headers: {},
    });
    expect(unsigned.status).toBe(401);
  });
});
