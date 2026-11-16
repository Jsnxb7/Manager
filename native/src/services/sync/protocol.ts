import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

/**
 * Wire format between the PC (host) and the phone: JSON bodies over HTTPS through
 * ngrok, each request signed with a key both devices share. No accounts.
 */
export const PROTOCOL = 1;
/** How far apart the two clocks may be. */
export const MAX_SKEW_MS = 5 * 60 * 1000;

export type SyncRequest = {
  method: 'GET' | 'POST';
  path: string;
  body: string;
  headers: Record<string, string>;
};
export type SyncResponse = { status: number; body: string };
/** Sends a request and returns the reply; real (fetch) or in-memory (tests). */
export type SyncTransport = (request: SyncRequest) => Promise<SyncResponse>;

/** Accepts the key as shown (grouped hex, any case, with or without dashes). */
export function cleanKey(value: string): string {
  return value.replace(/[^0-9a-f]/gi, '').toLowerCase();
}
export function validKey(value: string): boolean {
  return cleanKey(value).length === 32;
}
/** 32 hex digits shown as 8 groups of 4, easy to read off one screen and type. */
export function formatKey(value: string): string {
  return (cleanKey(value).match(/.{1,4}/g) ?? []).join('-').toUpperCase();
}

function signature(
  key: string,
  method: string,
  path: string,
  time: string,
  body: string,
): string {
  const bodyHash = bytesToHex(sha256(utf8ToBytes(body)));
  return bytesToHex(
    hmac(
      sha256,
      utf8ToBytes(cleanKey(key)),
      utf8ToBytes(`${method}\n${path}\n${time}\n${bodyHash}`),
    ),
  );
}

let lastSigned = 0;
export function signRequest(
  key: string,
  method: SyncRequest['method'],
  path: string,
  body = '',
  now = Date.now(),
): SyncRequest {
  // Two identical requests in the same millisecond must not look like a replay.
  lastSigned =
    now <= lastSigned && lastSigned - now < 1000 ? lastSigned + 1 : now;
  const time = String(lastSigned);
  return {
    method,
    path,
    body,
    headers: {
      'x-am-time': time,
      'x-am-sig': signature(key, method, path, time, body),
      // ngrok shows a browser warning page instead of the app without this.
      'ngrok-skip-browser-warning': '1',
      'content-type': 'application/json',
    },
  };
}

/** Recently seen signatures, so a captured request cannot be sent again. */
export class ReplayGuard {
  private seen = new Map<string, number>();
  use(sig: string, now: number): boolean {
    for (const [key, at] of this.seen) {
      if (now - at > MAX_SKEW_MS * 2) {
        this.seen.delete(key);
      }
    }
    if (this.seen.has(sig)) {
      return false;
    }
    this.seen.set(sig, now);
    return true;
  }
}

/** Returns why a request is refused, or null when it is genuine. */
export function verifyRequest(
  key: string,
  request: SyncRequest,
  guard: ReplayGuard,
  now = Date.now(),
): string | null {
  const header = (name: string) =>
    Object.entries(request.headers).find(
      ([k]) => k.toLowerCase() === name,
    )?.[1] ?? '';
  const time = header('x-am-time');
  const sig = header('x-am-sig');
  if (!validKey(key)) {
    return 'Sync is not set up on this device';
  }
  if (!time || !sig) {
    return 'Unsigned request';
  }
  if (Math.abs(now - Number(time)) > MAX_SKEW_MS) {
    return "Request time is too far off; check both devices' clocks";
  }
  const expected = signature(
    key,
    request.method,
    request.path,
    time,
    request.body,
  );
  if (expected.length !== sig.length || !timingSafeEqual(expected, sig)) {
    return 'Wrong sync key';
  }
  if (!guard.use(sig, now)) {
    return 'Repeated request';
  }
  return null;
}

/* eslint-disable no-bitwise -- constant-time comparison */
function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
/* eslint-enable no-bitwise */
