import React, { useState } from 'react';
import { strToU8 } from 'fflate';
import { Alert, Platform, ScrollView, Text, View } from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import { Button, Sheet } from '../components/controls';
import { ui } from '../design/theme';
import { windowAction } from '../platform/windowControls';
import {
  ImportPreview,
  exportCatalog,
  inspectLegacyFolder,
  inspectPackage,
  inspectSavedSnapshot,
} from '../services/transfer';
export function Settings({
  workspace: w,
  navigate,
}: {
  workspace: Workspace;
  navigate: (route: Route) => void;
}): React.JSX.Element {
  const [backups, setBackups] = useState<
    { name: string; uri: string }[] | null
  >(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const action = (job: () => Promise<void>, message?: string) => {
    w.run(job, message).catch(w.setError);
  };
  return (
    <ScrollView contentContainerStyle={ui.page}>
      <Text accessibilityRole="header" style={ui.heading}>
        Storage and Data
      </Text>
      <View style={ui.card}>
        <Text style={ui.subheading}>Local catalog</Text>
        {w.savedCatalogs.length > 1 &&
          w.savedCatalogs.map(saved => (
            <Button
              key={saved.path}
              label={`Open catalog ${saved.id}`}
              onPress={() =>
                action(() => w.openSavedCatalog(saved.path), 'Catalog opened')
              }
            />
          ))}
        <Text selectable style={ui.muted}>
          Catalog: {w.catalog!.id}
        </Text>
        <Text selectable style={ui.small}>
          Revision: {w.catalog!.revision}
        </Text>
        <Text style={ui.text}>
          {w.catalog!.entries.length} titles · {w.catalog!.sections.length}{' '}
          sections
        </Text>
        <View style={ui.row}>
          <Button
            label="Export catalog / Backup"
            primary
            onPress={() =>
              action(async () => {
                const result = await exportCatalog(w.repo!, w.io!);
                if (!result) {
                  throw new Error('Export cancelled');
                }
              }, 'Catalog exported without videos')
            }
          />
          <Button
            label="Import catalog ZIP"
            onPress={() =>
              action(async () => {
                const file = (await w.io!.pickFiles('catalog'))[0];
                if (file) {
                  setPreview(
                    await inspectPackage(await w.io!.readBytes(file), w.repo!),
                  );
                }
              }, 'Import ready for review')
            }
          />
          <Button
            label="Import original app folder"
            onPress={() =>
              action(async () => {
                const folder = await w.io!.pickFolder();
                if (folder) {
                  setPreview(await inspectLegacyFolder(folder, w.repo!, w.io!));
                }
              }, 'Legacy import ready for review')
            }
          />
          <Button
            label="Browse archived snapshots"
            onPress={() =>
              action(async () => {
                const root = `${w.io!.privateRoot}/snapshots`;
                setBackups(
                  (await w.io!.exists(root))
                    ? (await w.io!.list(root)).filter(file => !file.directory)
                    : [],
                );
              }, 'Local snapshots loaded')
            }
          />
          <Button
            label="Restore previous local snapshot"
            danger
            onPress={() =>
              Alert.alert(
                'Restore previous snapshot?',
                'The previous verified local backup will become active. Device media settings remain unchanged.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Restore',
                    onPress: () =>
                      action(async () => {
                        w.setCatalog(await w.repo!.restorePrevious());
                      }, 'Previous snapshot restored'),
                  },
                ],
              )
            }
          />
        </View>
        <Text style={ui.muted}>
          Exports include catalog records, metadata, covers, progress, queue and
          relations. Videos and device folder permissions are excluded.
        </Text>
      </View>
      <View style={ui.card}>
        <Text style={ui.subheading}>Media locations on this device</Text>
        {w
          .catalog!.sections.filter(section => section.kind === 'anime')
          .map(section => (
            <View key={section.id} style={ui.card}>
              <Text style={ui.text}>{section.title} root</Text>
              <Text selectable style={ui.muted}>
                {w.settings.roots[section.id] ?? 'No media folder selected'}
              </Text>
              <Button
                label="Choose / change media root"
                onPress={() =>
                  action(async () => {
                    const folder = await w.io!.pickFolder();
                    if (folder) {
                      await w.updateSettings(s => {
                        s.roots[section.id] = folder;
                      });
                    }
                  }, 'Media root saved for this device')
                }
              />
              <Text style={ui.small}>
                Choose the folder containing series folders, not the app or a
                season folder.
              </Text>
            </View>
          ))}
        <Button
          label="Clear title / episode overrides"
          onPress={() =>
            Alert.alert(
              'Clear local overrides?',
              'Titles will use the selected library root. Catalog metadata and progress stay unchanged.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Clear overrides',
                  onPress: () =>
                    action(
                      () =>
                        w.updateSettings(s => {
                          s.titleFolders = {};
                          s.episodeFiles = {};
                        }),
                      'Overrides cleared',
                    ),
                },
              ],
            )
          }
        />
      </View>
      <View style={ui.card}>
        <Text style={ui.subheading}>Tools</Text>
        {Platform.OS === 'windows' && (
          <View style={ui.row}>
            <Button
              label="Fullscreen"
              onPress={() => action(() => windowAction('fullscreen'))}
            />
            <Button
              label="Always on top"
              onPress={() => action(() => windowAction('alwaysOnTop'))}
            />
            <Button
              label="Reload UI"
              onPress={() => action(() => windowAction('reload'))}
            />
            <Button
              label="Restart app"
              onPress={() =>
                Alert.alert(
                  'Restart app?',
                  'Pause playback and save pending edits first.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Restart',
                      onPress: () => action(() => windowAction('restart')),
                    },
                  ],
                )
              }
            />
          </View>
        )}
        <Button
          label="Custom Player"
          onPress={() => navigate({ name: 'custom' })}
        />
        {Platform.OS === 'windows' && (
          <Button
            label="Open app data folder"
            onPress={() =>
              action(() => w.io!.reveal(w.io!.privateRoot), 'Folder opened')
            }
          />
        )}
        <Button
          label="Export diagnostics"
          onPress={() =>
            action(async () => {
              const diagnostic = {
                app: 'AnimeManager',
                platform: Platform.OS,
                schema: w.catalog!.schemaVersion,
                titles: w.catalog!.entries.length,
                sections: w.catalog!.sections.length,
                revision: w.catalog!.revision,
              };
              const bytes = strToU8(JSON.stringify(diagnostic, null, 2));
              await w.io!.saveFile('anime-manager-diagnostics.json', bytes);
            }, 'Diagnostics exported')
          }
        />
      </View>
      <Sheet
        title="Archived pre-import snapshots"
        visible={backups !== null}
        onClose={() => setBackups(null)}
      >
        {backups?.length === 0 && (
          <Text style={ui.muted}>No imports have been archived yet.</Text>
        )}
        {backups?.map(file => (
          <Button
            key={file.uri}
            label={file.name}
            onPress={() =>
              action(async () => {
                setPreview(
                  await inspectSavedSnapshot(file.uri, w.repo!, w.io!),
                );
                setBackups(null);
              }, 'Snapshot ready for review')
            }
          />
        ))}
      </Sheet>
      <Sheet
        title="Review catalog import"
        visible={preview !== null}
        onClose={() => setPreview(null)}
      >
        {preview && (
          <>
            <Text style={ui.text}>
              {preview.catalog.entries.length} titles ·{' '}
              {Object.keys(preview.artwork).length} covers ·{' '}
              {preview.catalog.queue.length} queued
            </Text>
            <Text style={ui.muted}>
              {preview.differentCatalog
                ? 'This opens a separate catalog and preserves your current one.'
                : 'This replaces the active snapshot after creating a backup.'}
            </Text>
            {preview.divergent && (
              <Text style={ui.error}>
                These catalogs have different revisions. They will not be
                merged. Keep an export of each device before choosing which
                snapshot to use.
              </Text>
            )}
            {preview.warnings.map((warning, index) => (
              <Text key={index} style={ui.muted}>
                {warning}
              </Text>
            ))}
            <Button
              label={
                preview.divergent
                  ? 'Use this snapshot explicitly'
                  : 'Import this catalog'
              }
              primary
              disabled={w.busy}
              onPress={() =>
                action(async () => {
                  await w.acceptImport(preview);
                  setPreview(null);
                }, 'Catalog imported; local media locations preserved')
              }
            />
          </>
        )}
      </Sheet>
    </ScrollView>
  );
}
