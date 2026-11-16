import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Field, TextButton } from './controls';
import { colors, ui } from '../design/theme';
import { Workspace } from '../app/useWorkspace';
import { SyncState } from '../app/useSync';
import { emptySync } from '../domain/catalog';
import { cleanKey, formatKey, validKey } from '../services/sync/protocol';
import { newSyncKey } from '../platform/syncNative';
import { APP_BUILD, APP_VERSION } from '../app/version';

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'never';

/**
 * Settings for PC <-> phone sync over ngrok. The PC shares (runs ngrok and holds
 * the key); the phone needs the PC's domain and the same key. No accounts.
 */
export function SyncSettings({
  workspace: w,
  sync,
}: {
  workspace: Workspace;
  sync: SyncState;
}): React.JSX.Element {
  const saved = w.settings.sync ?? emptySync();
  const [domain, setDomain] = useState(saved.domain);
  const [key, setKey] = useState(sync.host ? '' : formatKey(saved.key));
  const [port, setPort] = useState(String(saved.port));
  useEffect(() => {
    setDomain(saved.domain);
    setPort(String(saved.port));
    if (!sync.host) {
      setKey(formatKey(saved.key));
    }
    // Refill when the stored values change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.domain, saved.port, saved.key]);
  const cleanDomain = domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  const portNumber = Number(port);
  const changed =
    cleanDomain !== saved.domain ||
    (sync.host
      ? portNumber !== saved.port
      : cleanKey(key) !== cleanKey(saved.key));
  const valid =
    /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleanDomain) &&
    (sync.host
      ? Number.isInteger(portNumber) &&
        portNumber >= 1024 &&
        portNumber <= 65535
      : validKey(key));
  const save = () =>
    w
      .run(() =>
        w.updateSettings(s => {
          s.sync = {
            ...(s.sync ?? emptySync()),
            domain: cleanDomain,
            ...(sync.host ? { port: portNumber } : { key: cleanKey(key) }),
          };
        }),
      )
      .catch(w.setError);
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={ui.subheading}>
        Sync with {sync.host ? 'phone' : 'PC'} (ngrok)
      </Text>
      <View style={ui.rule} />
      {sync.host ? (
        <Text style={ui.muted}>
          Your phone syncs with this PC through ngrok. Install ngrok once, add
          your authtoken (ngrok config add-authtoken …), and enter your free
          static domain here. Only requests signed with the sync key below are
          answered.
        </Text>
      ) : (
        <>
          <Button
            label={sync.busy ? 'Syncing…' : 'Sync with PC'}
            primary
            disabled={sync.busy}
            onPress={() => {
              sync.press().catch(w.setError);
            }}
          />
          <Text style={ui.muted}>
            Enter the PC's ngrok domain and the sync key shown in the PC app's
            Settings. The app looks for the PC when it opens, when you come back
            to it and when the network changes.
          </Text>
        </>
      )}
      <Field
        label={sync.host ? 'ngrok domain' : "PC's ngrok domain"}
        placeholder="your-name.ngrok-free.dev"
        value={domain}
        onChange={setDomain}
      />
      {sync.host ? (
        <>
          <Field label="Local port" numeric value={port} onChange={setPort} />
          <View style={styles.keyRow}>
            <View style={ui.grow}>
              <Text style={ui.muted}>Sync key (type this into the phone)</Text>
              <Text selectable style={styles.key}>
                {validKey(saved.key) ? formatKey(saved.key) : 'No key yet'}
              </Text>
            </View>
            <TextButton
              label={validKey(saved.key) ? 'New key' : 'Create key'}
              onPress={() => {
                w.run(async () => {
                  const fresh = await newSyncKey();
                  await w.updateSettings(s => {
                    s.sync = { ...(s.sync ?? emptySync()), key: fresh };
                  });
                }, 'New sync key: enter it on the phone too').catch(w.setError);
              }}
            />
          </View>
        </>
      ) : (
        <Field
          label="Sync key"
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          value={key}
          onChange={setKey}
        />
      )}
      <View style={styles.row}>
        <Button label="Save" disabled={!changed || !valid} onPress={save} />
        {sync.host && (
          <Button
            label={sync.sharing ? 'Stop sharing' : 'Share with phone'}
            primary={!sync.sharing}
            disabled={!sync.configured || changed}
            onPress={() => {
              sync.share(!sync.sharing).catch(w.setError);
            }}
          />
        )}
      </View>
      <View style={styles.version}>
        <Text style={[ui.muted, ui.grow]}>
          Anime Manager {APP_VERSION} (build {APP_BUILD})
          {sync.update
            ? `: version ${sync.update.version} is ready`
            : sync.host
            ? ''
            : ': updates come from the PC when you sync'}
        </Text>
        {sync.update ? (
          <Button
            label="Install update"
            primary
            disabled={sync.busy}
            onPress={() => {
              sync.installUpdate().catch(w.setError);
            }}
          />
        ) : (
          sync.host && (
            <TextButton
              label="Check for updates"
              onPress={() => {
                sync
                  .findPcUpdate()
                  .then(found =>
                    w.notify(
                      found && found.build > APP_BUILD
                        ? `Version ${found.version} is ready`
                        : 'This is the newest version (run npm run release to build one)',
                    ),
                  )
                  .catch(w.setError);
              }}
            />
          )
        )}
      </View>
      <Text style={ui.small}>
        {sync.host
          ? sync.sharing
            ? sync.online
              ? `Sharing at https://${saved.domain}`
              : 'Starting ngrok…'
            : 'Not sharing'
          : sync.configured
          ? 'Ready: press Sync with PC'
          : 'Not set up'}
        {'  ·  '}Last synced {when(saved.lastSyncedAt)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 14, marginBottom: 40 },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  key: {
    ...ui.text,
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
    color: colors.mist,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  version: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
});
