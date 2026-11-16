import { useEffect, useRef } from 'react';
import { DeviceEventEmitter, Platform } from 'react-native';

/** Files dropped onto the window (Windows); the newest screen that wants them gets them. */
type DropHandler = (paths: string[]) => void;
const handlers: DropHandler[] = [];

if (Platform.OS === 'windows') {
  // Native joins the paths with "|", which Windows file names cannot contain.
  DeviceEventEmitter.addListener('filesDropped', (paths: unknown) => {
    const list =
      typeof paths === 'string' ? paths.split('|').filter(Boolean) : [];
    if (list.length) {
      handlers[handlers.length - 1]?.(list);
    }
  });
}

export const canDropFiles = Platform.OS === 'windows';

export const VIDEO_EXTENSIONS = [
  '.mp4',
  '.mkv',
  '.webm',
  '.avi',
  '.mov',
  '.m4v',
];
export const IMAGE_EXTENSIONS = ['.webp', '.png', '.jpg', '.jpeg', '.gif'];

export function hasExtension(path: string, extensions: string[]): boolean {
  const lower = path.toLowerCase();
  return extensions.some(extension => lower.endsWith(extension));
}

export function useFileDrops(onDrop: DropHandler): void {
  const latest = useRef(onDrop);
  latest.current = onDrop;
  useEffect(() => {
    const handler: DropHandler = paths => latest.current(paths);
    handlers.push(handler);
    return () => {
      const at = handlers.lastIndexOf(handler);
      if (at >= 0) {
        handlers.splice(at, 1);
      }
    };
  }, []);
}
