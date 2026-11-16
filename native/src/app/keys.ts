import { useEffect, useRef } from 'react';
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

/** Returns true when it used the key, which stops older handlers seeing it. */
export type KeyHandler = (key: string) => boolean;

const stack: KeyHandler[] = [];

/** The newest handler sees a key first, so the dialog on top closes first. */
export function pushKeyHandler(handler: KeyHandler): () => void {
  stack.push(handler);
  return () => {
    const at = stack.lastIndexOf(handler);
    if (at >= 0) {
      stack.splice(at, 1);
    }
  };
}

export function handleAppKey(key: string): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]!(key)) {
      return true;
    }
  }
  return false;
}

// Windows reports Esc from a native keyboard hook (WindowControls.h), so it works
// wherever focus is. Android uses its Back button instead.
if (Platform.OS === 'windows') {
  // Native modules start on first use; this one sends the keys and dropped files.
  NativeModules.WindowControls?.getConstants?.();
  DeviceEventEmitter.addListener('appKey', (key: unknown) => {
    if (typeof key === 'string') {
      handleAppKey(key);
    }
  });
}

/** Calls onEscape while active is true. */
export function useEscape(active: boolean, onEscape: () => void): void {
  const latest = useRef(onEscape);
  latest.current = onEscape;
  useEffect(() => {
    if (!active) {
      return;
    }
    return pushKeyHandler(key => {
      if (key !== 'Escape') {
        return false;
      }
      latest.current();
      return true;
    });
  }, [active]);
}
