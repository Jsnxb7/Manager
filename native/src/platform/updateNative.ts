import { NativeModules } from 'react-native';
import { windowAction } from './windowControls';

type Storage = { execute(method: string, json: string): Promise<string> };
async function storage<T>(
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  const module = NativeModules.CatalogStorage as Storage | undefined;
  if (!module) {
    throw new Error('App updates are unavailable on this device.');
  }
  return JSON.parse(await module.execute(method, JSON.stringify(args))) as T;
}

/** Android: fetch the update over the signed sync connection into the app's cache. */
export const downloadApk = (
  url: string,
  headers: Record<string, string>,
  name: string,
) => storage<string>('downloadFile', { url, headers, name });

/** Android: hand the APK to the system installer (it asks the person first). */
export const installApk = (path: string) =>
  storage<null>('installApk', { path });

/** Windows: run the installer from the updates folder and close the app. */
export const runInstaller = (path: string) =>
  windowAction(`runInstaller|${path}`);
