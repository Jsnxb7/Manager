import { NativeModules } from 'react-native';
export async function windowAction(
  action: 'fullscreen' | 'alwaysOnTop' | 'reload' | 'restart',
): Promise<void> {
  const module = NativeModules.WindowControls as
    | { execute(action: string): Promise<void> }
    | undefined;
  if (!module) {
    throw new Error('Desktop window controls are unavailable in this host.');
  }
  await module.execute(action);
}
