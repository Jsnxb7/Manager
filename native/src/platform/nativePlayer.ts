import { NativeModules } from 'react-native';
import { PlaybackState } from '../services/progress';
type Driver = (
  method: string,
  args: Record<string, unknown>,
) => Promise<PlaybackState>;
let driver: Driver | null = null;
export function registerPlayerDriver(value: Driver): () => void {
  driver = value;
  return () => {
    if (driver === value) {
      driver = null;
    }
  };
}
type NativePlayer = { execute(method: string, json: string): Promise<string> };
export async function playerCommand<T = PlaybackState>(
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (driver) {
    return (await driver(method, args)) as T;
  }
  const player = NativeModules.CatalogPlayer as NativePlayer | undefined;
  if (!player) {
    throw new Error('Native video playback is unavailable in this host.');
  }
  return JSON.parse(await player.execute(method, JSON.stringify(args))) as T;
}
