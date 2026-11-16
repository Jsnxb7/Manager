import { NativeModules, Platform } from 'react-native';

/** The PC's sync server and ngrok launcher (windows/AnimeManager/SyncServer.h). */
type Native = { execute(method: string, json: string): Promise<string> };
export type ShareStatus = { sharing: boolean; url: string };

export const canHost = Platform.OS === 'windows';

async function call<T>(
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const module = NativeModules.SyncServer as Native | undefined;
  if (!module) {
    throw new Error('Sharing for sync runs on the PC app.');
  }
  return JSON.parse(await module.execute(method, JSON.stringify(args))) as T;
}

export const newSyncKey = async (): Promise<string> =>
  (await call<{ key: string }>('randomKey')).key;
export const startSharing = (domain: string, port: number) =>
  call<ShareStatus>('start', { domain, port });
export const stopSharing = () => call<ShareStatus>('stop');
export const shareStatus = () => call<ShareStatus>('status');
export const respond = (id: number, status: number, body: string) =>
  call<ShareStatus>('respond', { id, status, body });
