import { useCallback, useEffect, useRef, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { Workspace } from './useWorkspace';
import { emptySync } from '../domain/catalog';
import { Choice } from '../services/sync/merge';
import { signRequest, validKey } from '../services/sync/protocol';
import {
  UpdateManifest,
  isNewer,
  readLocalUpdate,
  verifiedUpdateFile,
} from '../services/update';
import {
  downloadApk,
  installApk,
  runInstaller,
} from '../platform/updateNative';
import { Proposal, createHost } from '../services/sync/host';
import {
  ClientDeps,
  Hello,
  Prepared,
  SyncError,
  fetchTransport,
  finishSync,
  hello,
  prepareSync,
} from '../services/sync/client';
import {
  canHost,
  respond,
  startSharing,
  stopSharing,
} from '../platform/syncNative';

/**
 * PC <-> phone sync over ngrok. Nothing here polls: the PC learns from ngrok's own
 * log when its tunnel is up, and the phone looks for the PC only when the sync
 * button is pressed.
 */
export function useSync(w: Workspace) {
  const settings = w.settings.sync ?? null;
  const configured =
    !!settings && validKey(settings.key) && settings.domain.trim() !== '';
  const [online, setOnline] = useState(false);
  const [sharing, setSharing] = useState(false);
  /** The sync button was pressed before sync was set up. */
  const [needsSetup, setNeedsSetup] = useState(false);
  /** Phone: a newer app build the PC offered at the last sync. */
  const [offered, setOffered] = useState<Hello['update'] | null>(null);
  /** PC: a newer installer published by `npm run release`. */
  const [pcUpdate, setPcUpdate] = useState<UpdateManifest | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState(false);
  /** Phone: confirmed here, waiting for the PC's yes. */
  const [waiting, setWaiting] = useState(false);
  const stopRequested = useRef(false);
  /** PC: the phone's confirmed sync, waiting for a yes here. */
  const [incoming, setIncoming] = useState<Proposal | null>(null);
  const hostRef = useRef<ReturnType<typeof createHost> | null>(null);
  const latest = useRef(w);
  latest.current = w;

  const stamp = useCallback(() => {
    latest.current
      .updateSettings(s => {
        s.sync = {
          ...(s.sync ?? emptySync()),
          lastSyncedAt: new Date().toISOString(),
        };
      })
      .catch(latest.current.setError);
  }, []);

  // ---- PC: answer the phone, and listen to ngrok coming and going ----------
  useEffect(() => {
    if (!canHost) {
      return;
    }
    const host = createHost({
      key: () => latest.current.settings.sync?.key ?? '',
      repo: () => latest.current.repo,
      io: () => latest.current.io,
      update: () =>
        latest.current.io
          ? readLocalUpdate(latest.current.io)
          : Promise.resolve(null),
      onCommitted: saved => {
        latest.current.setCatalog(saved);
        stamp();
        latest.current.notify('Synced with your phone');
      },
      onProposal: proposal => {
        setIncoming(current => {
          // The phone stopped waiting before anyone answered here.
          if (!proposal && current?.status === 'waiting') {
            latest.current.notify('Your phone cancelled the sync');
          }
          return proposal;
        });
      },
    });
    hostRef.current = host;
    const requests = DeviceEventEmitter.addListener(
      'syncRequest',
      (raw: string) => {
        const request = JSON.parse(raw) as {
          id: number;
          method: 'GET' | 'POST';
          path: string;
          headers: Record<string, string>;
          body: string;
        };
        host(request)
          .then(reply => respond(request.id, reply.status, reply.body))
          .catch(error =>
            respond(request.id, 500, JSON.stringify({ error: String(error) })),
          );
      },
    );
    const availability = DeviceEventEmitter.addListener(
      'syncAvailability',
      (raw: string) => {
        const event = JSON.parse(raw) as { state: string; reason: string };
        const up = event.state === 'online';
        setOnline(up);
        if (up) {
          latest.current.notify('ngrok is available: your phone can sync now');
        } else if (event.reason && event.reason !== 'Sharing turned off') {
          setSharing(false);
          latest.current.setError(`ngrok stopped: ${event.reason}`);
        }
      },
    );
    return () => {
      requests.remove();
      availability.remove();
      hostRef.current = null;
    };
  }, [stamp]);

  const share = useCallback(async (on: boolean) => {
    const sync = latest.current.settings.sync;
    if (on && (!sync || !validKey(sync.key) || !sync.domain.trim())) {
      throw new Error('Set the ngrok domain and sync key in Settings first.');
    }
    if (on) {
      setSharing(true);
      try {
        await startSharing(sync!.domain.trim(), sync!.port);
      } catch (error) {
        setSharing(false);
        throw error;
      }
    } else {
      setSharing(false);
      setOnline(false);
      await stopSharing();
    }
    await latest.current.updateSettings(s => {
      s.sync = { ...(s.sync ?? emptySync()), share: on };
    });
  }, []);

  // PC: share whenever the app is open, once the library is ready.
  const wantShare = canHost && configured && !!settings?.share;
  const ready = !!w.repo;
  useEffect(() => {
    if (wantShare && ready && !sharing) {
      share(true).catch(latest.current.setError);
    }
    // Only when the wish or readiness changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantShare, ready]);

  // ---- Phone: look for the PC on events, then sync on request ---------------
  const deps = useCallback((): ClientDeps | null => {
    const now = latest.current;
    const sync = now.settings.sync;
    if (!sync || !now.io || !now.repo || !validKey(sync.key) || !sync.domain) {
      return null;
    }
    return {
      transport: fetchTransport(sync.domain),
      key: sync.key,
      io: now.io,
      repo: now.repo,
    };
  }, []);

  const syncNow = useCallback(async () => {
    const d = deps();
    if (!d) {
      throw new Error('Set up sync in Settings first.');
    }
    setBusy(true);
    try {
      const reply = await hello(d);
      setOffered(isNewer(reply.update) ? reply.update ?? null : null);
      const plan = await prepareSync(d);
      if (plan.kind === 'inSync') {
        stamp();
        latest.current.notify('Already in sync with the PC');
      } else {
        setPrepared(plan);
      }
    } finally {
      setBusy(false);
    }
  }, [deps, stamp]);

  const confirm = useCallback(
    async (choices: Record<string, Choice>) => {
      const d = deps();
      const plan = prepared;
      if (!d || !plan || plan.kind === 'inSync') {
        return;
      }
      setBusy(true);
      stopRequested.current = false;
      try {
        const saved = await finishSync(d, plan, choices, {
          onWaiting: () => setWaiting(true),
          cancelled: () => stopRequested.current,
        });
        latest.current.setCatalog(saved);
        setPrepared(null);
        stamp();
        latest.current.notify('Synced with the PC');
      } catch (error) {
        if (error instanceof SyncError && error.status === 499) {
          // Stopped here: the plan stays open to try again.
          return;
        }
        if (error instanceof SyncError && error.status === 409) {
          // Something changed meanwhile: work it out again from fresh copies.
          setPrepared(null);
          await syncNow();
          return;
        }
        throw error;
      } finally {
        setWaiting(false);
        setBusy(false);
      }
    },
    [deps, prepared, stamp, syncNow],
  );

  // PC: a published release is noticed once the app data is open (a local file,
  // read on start and when asked).
  const io = w.io;
  const findPcUpdate = useCallback(async () => {
    const now = latest.current.io;
    const found = canHost && now ? await readLocalUpdate(now) : null;
    setPcUpdate(found && isNewer(found) && found.windows ? found : null);
    return found;
  }, []);
  useEffect(() => {
    if (io) {
      findPcUpdate().catch(() => undefined);
    }
  }, [io, findPcUpdate]);

  /** Installs the offered update: the PC's installer, or the phone's APK from the PC. */
  const installUpdate = useCallback(async () => {
    const now = latest.current;
    if (!now.io) {
      return;
    }
    if (canHost) {
      if (!pcUpdate?.windows) {
        throw new Error('No update is waiting');
      }
      await runInstaller(await verifiedUpdateFile(now.io, pcUpdate.windows));
      return;
    }
    const sync = now.settings.sync;
    if (!offered || !sync) {
      throw new Error('Press Sync to look for an update on the PC');
    }
    setBusy(true);
    try {
      now.notify(`Downloading version ${offered.version}…`);
      const signed = signRequest(sync.key, 'GET', '/sync/update/apk');
      const host = sync.domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      const file = await downloadApk(
        `https://${host}/sync/update/apk`,
        signed.headers,
        `AnimeManager-${offered.version}.apk`,
      );
      const hashes = now.io.hashFiles ? await now.io.hashFiles([file]) : {};
      if (hashes[file] !== offered.sha256) {
        throw new Error('The update arrived damaged; try again');
      }
      await installApk(file);
    } finally {
      setBusy(false);
    }
  }, [offered, pcUpdate]);

  /** The top-bar / Settings button. */
  const press = useCallback(async () => {
    // Nothing is looked up until sync is set up; the toast points to Settings.
    const sync = latest.current.settings.sync;
    if (!sync || !validKey(sync.key) || !sync.domain.trim()) {
      setNeedsSetup(true);
      return;
    }
    if (canHost) {
      if (!sharing) {
        await share(true);
        latest.current.notify('Starting ngrok…');
      } else {
        latest.current.notify(
          online
            ? 'Sharing through ngrok: open the app on your phone to sync'
            : 'Waiting for ngrok to connect…',
        );
      }
      return;
    }
    await syncNow();
  }, [online, share, sharing, syncNow]);

  return {
    configured,
    host: canHost,
    online,
    sharing,
    needsSetup,
    dismissSetup: () => setNeedsSetup(false),
    /** The update this device can install now, if any. */
    update: canHost
      ? pcUpdate && { version: pcUpdate.version, build: pcUpdate.build }
      : offered && { version: offered.version, build: offered.build },
    installUpdate,
    findPcUpdate,
    prepared,
    cancel: () => setPrepared(null),
    waiting,
    stopWaiting: () => {
      stopRequested.current = true;
    },
    incoming,
    /** PC: apply or decline the phone's sync. */
    answer: (approve: boolean) => {
      if (incoming) {
        hostRef.current?.decide(incoming.id, approve);
        if (!approve) {
          latest.current.notify('Sync declined; nothing was changed');
        }
      }
    },
    busy,
    press,
    share,
    syncNow,
    confirm,
  };
}
export type SyncState = ReturnType<typeof useSync>;
