import React, { useState } from 'react';
import { strToU8 } from 'fflate';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import { Button, HoverRow, Sheet, TextButton } from '../components/controls';
import { PanelPage } from '../components/Fade';
import { Icon } from '../components/Icon';
import { colors, ui } from '../design/theme';
import { useViewport } from '../design/viewport';
import { windowAction } from '../platform/windowControls';
import {
  FolderPreview,
  createMissingMediaFolders,
  previewMediaFolders,
} from '../services/mediaFolders';
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
  const { width } = useViewport();
  const [backups, setBackups] = useState<
    { name: string; uri: string }[] | null
  >(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [folderPreview, setFolderPreview] = useState<FolderPreview | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState<{
    title: string;
    message: string;
    buttons: { text: string; style?: string; onPress?: () => void }[];
  } | null>(null);
  const confirm = (
    title: string,
    message: string,
    buttons: NonNullable<typeof confirmation>['buttons'],
  ) => setConfirmation({ title, message, buttons });
  const action = (job: () => Promise<void>, message?: string) => {
    w.run(job, message).catch(w.setError);
  };
  return (
    <PanelPage width={1050}>
      <View style={[styles.column, width < 700 && styles.columnPhone]}>
        <Text accessibilityRole="header" style={ui.heading}>
          Storage and data
        </Text>
        <View style={styles.group}>
          <Text accessibilityRole="header" style={ui.subheading}>
            Local catalog
          </Text>
          <View style={ui.rule} />
          {w.savedCatalogs.length > 1 &&
            w.savedCatalogs.map(saved => (
              <SettingRow
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
            {w.catalog!.entries.length} titles, {w.catalog!.sections.length}{' '}
            sections
          </Text>
          <View style={styles.actions}>
            <SettingRow
              label="Export catalog / Backup"
              onPress={() =>
                action(async () => {
                  const result = await exportCatalog(w.repo!, w.io!);
                  if (!result) {
                    throw new Error('Export cancelled');
                  }
                }, 'Catalog exported without videos')
              }
            />
            <SettingRow
              label="Import catalog ZIP"
              onPress={() =>
                action(async () => {
                  const file = (await w.io!.pickFiles('catalog'))[0];
                  if (file) {
                    setPreview(
                      await inspectPackage(
                        await w.io!.readBytes(file),
                        w.repo!,
                      ),
                    );
                  }
                }, 'Import ready for review')
              }
            />
            <SettingRow
              label="Import original app folder"
              onPress={() =>
                action(async () => {
                  const folder = await w.io!.pickFolder();
                  if (folder) {
                    setPreview(
                      await inspectLegacyFolder(folder, w.repo!, w.io!),
                    );
                  }
                }, 'Legacy import ready for review')
              }
            />
            <SettingRow
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
            <View style={styles.danger}>
              <View style={ui.rule} />
              <SettingRow
                label="Restore previous local snapshot"
                danger
                onPress={() =>
                  confirm(
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
          </View>
          <Text style={ui.muted}>
            Exports include catalog records, metadata, covers, progress, queue
            and relations. Videos and device folder permissions are excluded.
          </Text>
        </View>
        <View style={styles.group}>
          <Text accessibilityRole="header" style={ui.subheading}>
            Media locations on this device
          </Text>
          <View style={ui.rule} />
          {w
            .catalog!.sections.filter(section => section.kind === 'anime')
            .map(section => (
              <View key={section.id} style={styles.group}>
                <Text style={ui.text}>{section.title} root</Text>
                <Text selectable style={ui.muted}>
                  {w.settings.roots[section.id] ?? 'No media folder selected'}
                </Text>
                <SettingRow
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
                {w.settings.roots[section.id] && (
                  <>
                    <SettingRow
                      label="Create missing folders"
                      onPress={() =>
                        action(async () => {
                          setFolderPreview(
                            await previewMediaFolders(
                              w.catalog!.entries.filter(
                                e => e.sectionId === section.id,
                              ),
                              w.settings.roots[section.id]!,
                              w.io!,
                            ),
                          );
                        })
                      }
                    />
                    <SettingRow
                      label="Clear media folder"
                      danger
                      onPress={() =>
                        confirm(
                          'Clear media folder?',
                          `Remove the media root setting for ${section.title} on this device? Files and relinked locations remain unchanged.`,
                          [
                            { text: 'Cancel' },
                            {
                              text: 'Clear',
                              onPress: () =>
                                action(
                                  () =>
                                    w.updateSettings(s => {
                                      delete s.roots[section.id];
                                    }),
                                  'Media folder setting cleared; files preserved',
                                ),
                            },
                          ],
                        )
                      }
                    />
                  </>
                )}
              </View>
            ))}
          <View style={styles.danger}>
            <View style={ui.rule} />
            <SettingRow
              danger
              label="Clear relinked files"
              onPress={() =>
                confirm(
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
        </View>
        <View style={styles.group}>
          <Text accessibilityRole="header" style={ui.subheading}>
            Tools
          </Text>
          <View style={ui.rule} />
          {Platform.OS === 'windows' && (
            <View style={styles.actions}>
              <SettingRow
                label="Fullscreen"
                onPress={() => action(() => windowAction('fullscreen'))}
              />
              <SettingRow
                label="Always on top"
                onPress={() => action(() => windowAction('alwaysOnTop'))}
              />
              <SettingRow
                label="Reload UI"
                onPress={() => action(() => windowAction('reload'))}
              />
              <SettingRow
                label="Restart app"
                onPress={() =>
                  confirm(
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
          <SettingRow
            label="Custom Player"
            onPress={() => navigate({ name: 'custom' })}
          />
          {Platform.OS === 'windows' && (
            <SettingRow
              label="Open app data folder"
              onPress={() =>
                action(() => w.io!.reveal(w.io!.privateRoot), 'Folder opened')
              }
            />
          )}
          <SettingRow
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
          title="Create missing folders"
          visible={folderPreview !== null}
          onClose={() => setFolderPreview(null)}
        >
          {folderPreview && (
            <>
              <Text selectable style={ui.muted}>
                {folderPreview.root}
              </Text>
              <Text style={ui.text}>
                {folderPreview.missing.length} missing,{' '}
                {folderPreview.existing.length} existing,{' '}
                {folderPreview.skipped.length} skipped
              </Text>
              {folderPreview.missing.slice(0, 8).map(folder => (
                <Text key={folder} selectable style={ui.text}>
                  {folder}
                </Text>
              ))}
              {folderPreview.missing.length > 8 && (
                <Text style={ui.muted}>
                  And {folderPreview.missing.length - 8} more folders.
                </Text>
              )}
              <Button
                label="Create"
                primary
                disabled={w.busy || !folderPreview.missing.length}
                onPress={() =>
                  action(async () => {
                    const previewToCreate = folderPreview;
                    setFolderPreview(null);
                    await createMissingMediaFolders(previewToCreate, w.io!);
                  }, `${folderPreview.missing.length} folders ready`)
                }
              />
            </>
          )}
        </Sheet>
        <Sheet
          title="Archived pre-import snapshots"
          visible={backups !== null}
          onClose={() => setBackups(null)}
        >
          {backups?.length === 0 && (
            <Text style={ui.muted}>No imports have been archived yet.</Text>
          )}
          {backups?.map(file => (
            <SettingRow
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
                {preview.catalog.entries.length} titles,{' '}
                {Object.keys(preview.artwork).length} covers,{' '}
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

        <Sheet
          title={confirmation?.title ?? ''}
          visible={confirmation !== null}
          onClose={() => setConfirmation(null)}
        >
          <Text style={ui.text}>{confirmation?.message}</Text>
          <View style={ui.row}>
            {confirmation?.buttons.map(button => (
              <TextButton
                key={button.text}
                label={button.text}
                onPress={() => {
                  setConfirmation(null);
                  button.onPress?.();
                }}
              />
            ))}
          </View>
        </Sheet>
      </View>
    </PanelPage>
  );
}

const explanations: Record<string, string> = {
  'Export catalog / Backup':
    'Save records, artwork and progress without videos or device permissions.',
  'Import catalog ZIP': 'Review a catalog package before applying it.',
  'Import original app folder':
    'Bring in records and artwork from the original app.',
  'Browse archived snapshots':
    'Review catalog snapshots saved before earlier imports.',
  'Restore previous local snapshot':
    'Replace the active catalog with the previous verified local backup.',
  'Choose / change media root':
    'Set the folder used to locate videos on this device.',
  'Clear relinked files':
    'Return all title and episode locations to the selected library roots.',
  'Create missing folders':
    'Preview missing title and season folders before creating them.',
  'Clear media folder':
    'Forget this section’s media root on this device. Files stay in place.',
  Fullscreen: 'Toggle the app window fullscreen.',
  'Always on top': 'Toggle whether the app stays above other windows.',
  'Reload UI': 'Reload the app interface.',
  'Restart app': 'Restart after saving edits and pausing playback.',
  'Custom Player': 'Open a temporary playlist of local videos.',
  'Open app data folder': 'Reveal the app local storage folder.',
  'Export diagnostics': 'Save platform and catalog counts for troubleshooting.',
};
function SettingRow({
  label,
  onPress,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}): React.JSX.Element {
  const { width } = useViewport();
  return (
    <HoverRow
      label={label}
      onPress={onPress}
      style={[styles.setting, width < 700 && styles.settingPhone]}
    >
      <View style={styles.description}>
        <Text style={[ui.text, danger && ui.dangerText]}>{label}</Text>
        <Text style={ui.muted}>
          {explanations[label] ?? 'Switch to this saved local catalog.'}
        </Text>
      </View>
      <View style={styles.control}>
        <Text style={[ui.small, danger && ui.dangerText]}>
          {danger
            ? 'Review'
            : label.startsWith('Export')
            ? 'Export'
            : label.startsWith('Import')
            ? 'Import'
            : label === 'Fullscreen' || label === 'Always on top'
            ? 'Toggle'
            : label === 'Reload UI'
            ? 'Reload'
            : label === 'Restart app'
            ? 'Restart'
            : label === 'Choose / change media root'
            ? 'Choose'
            : 'Open'}
        </Text>
        <Icon
          name="forward"
          size={18}
          color={danger ? colors.danger : colors.chrome}
        />
      </View>
    </HoverRow>
  );
}
const styles = StyleSheet.create({
  column: { maxWidth: 860, width: '100%', alignSelf: 'center', gap: 40 },
  columnPhone: { gap: 32 },
  group: { gap: 16 },
  actions: { gap: 4 },
  setting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    paddingVertical: 16,
  },
  settingPhone: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  description: { flex: 1, gap: 4 },
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 32,
    alignSelf: 'flex-end',
  },
  danger: { gap: 16, marginTop: 24 },
});
