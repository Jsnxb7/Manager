import React, { useEffect, useState } from 'react';
import { CatalogSummary } from '../repositories/CatalogRegistry';

const shortDate = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'unknown'
    : date.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
};
import { strToU8 } from 'fflate';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { SyncState } from '../app/useSync';
import { SyncSettings } from '../components/SyncSettings';
import { Route } from '../app/routes';
import { Button, HoverRow, Sheet, TextButton } from '../components/controls';
import { PanelPage } from '../components/Fade';
import { Icon } from '../components/Icon';
import { colors, fontFamily, ui } from '../design/theme';
import { useViewport } from '../design/viewport';
import { windowAction } from '../platform/windowControls';
import {
  FolderPreview,
  createMissingMediaFolders,
  previewMediaFolders,
  resetFolderLinks,
} from '../services/mediaFolders';
import { scanAllRelations } from '../services/relations';
import {
  ImportPreview,
  exportCatalog,
  inspectLegacyFolder,
  inspectPackageFile,
  inspectSavedSnapshot,
} from '../services/transfer';
export function Settings({
  workspace: w,
  navigate,
  sync,
}: {
  workspace: Workspace;
  navigate: (route: Route) => void;
  sync: SyncState;
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
  const [catalogs, setCatalogs] = useState<CatalogSummary[]>([]);
  const [log, setLog] = useState<string[] | null>(null);
  const savedCount = w.savedCatalogs.length;
  useEffect(() => {
    let live = true;
    w.describeCatalogs()
      .then(list => live && setCatalogs(list))
      .catch(w.setError);
    return () => {
      live = false;
    };
    // Re-read when catalogs are added, removed or switched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCount, w.catalog?.id]);
  return (
    <PanelPage width={1050}>
      <View style={[styles.column, width < 700 && styles.columnPhone]}>
        <Text accessibilityRole="header" style={ui.heading}>
          Storage and data
        </Text>
        <SyncSettings workspace={w} sync={sync} />
        <View style={styles.group}>
          <Text accessibilityRole="header" style={ui.subheading}>
            Local catalog
          </Text>
          <View style={ui.rule} />
          {catalogs.length > 1 &&
            catalogs
              .filter(saved => !saved.active)
              .map(saved =>
                saved.titles === 0 ? (
                  <SettingRow
                    key={saved.path}
                    label={`Remove empty catalog${
                      saved.updatedAt
                        ? ` (last changed ${shortDate(saved.updatedAt)})`
                        : ''
                    }`}
                    danger
                    onPress={() =>
                      confirm(
                        'Remove empty catalog?',
                        'It holds no titles. The open catalog is not affected.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Remove',
                            style: 'destructive',
                            onPress: () =>
                              action(async () => {
                                await w.removeEmptyCatalog(saved.path);
                                setCatalogs(await w.describeCatalogs());
                              }, 'Empty catalog removed'),
                          },
                        ],
                      )
                    }
                  />
                ) : (
                  <SettingRow
                    key={saved.path}
                    label={`Open other catalog: ${
                      saved.titles === null
                        ? 'unreadable'
                        : `${saved.titles} titles`
                    }${
                      saved.updatedAt
                        ? `, last changed ${shortDate(saved.updatedAt)}`
                        : ''
                    }`}
                    onPress={() =>
                      action(async () => {
                        await w.openSavedCatalog(saved.path);
                        setCatalogs(await w.describeCatalogs());
                      }, 'Catalog opened')
                    }
                  />
                ),
              )}
          <Text style={ui.muted}>
            Open catalog last changed {shortDate(w.catalog!.updatedAt)}
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
                    setPreview(await inspectPackageFile(file, w.repo!, w.io!));
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
            <SettingRow
              danger
              label="Reset all folder links"
              onPress={() =>
                confirm(
                  'Reset all folder links?',
                  'Clears every media folder choice and every relinked title folder and episode file on this device. Titles, progress and video files are not touched; choose the media folders again afterwards.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Reset links',
                      style: 'destructive',
                      onPress: () =>
                        action(
                          () => w.updateSettings(resetFolderLinks),
                          'Folder links reset; files preserved',
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
          <SettingRow
            label="Check relations for all anime"
            onPress={() =>
              confirm(
                'Check relations for all anime?',
                'Links seasons of the same series across the whole library, the way adding a title does. Pairs you removed before stay apart.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Check',
                    onPress: () =>
                      w
                        .run(async () => {
                          let found = 0;
                          await w.mutate(c => {
                            found = scanAllRelations(c);
                          });
                          return found
                            ? `${found} titles newly linked`
                            : 'No new relations found';
                        })
                        .catch(w.setError),
                  },
                ],
              )
            }
          />
          <SettingRow
            label="View error log"
            onPress={() => {
              // Just opens a view, so no "Saved" notice.
              const path = `${w.io!.privateRoot}/app-log.txt`;
              w.io!.exists(path)
                .then(found => (found ? w.io!.readText(path) : ''))
                .then(text =>
                  setLog(
                    text.split('\n').filter(Boolean).slice(-200).reverse(),
                  ),
                )
                .catch(w.setError);
            }}
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
          title="Error log"
          visible={log !== null}
          onClose={() => setLog(null)}
        >
          {log && log.length === 0 && (
            <Text style={ui.muted}>No errors have been logged.</Text>
          )}
          {log && log.length > 0 && (
            <ScrollView style={styles.log}>
              {log.map((line, index) => (
                <Text key={index} selectable style={[ui.small, styles.logLine]}>
                  {line}
                </Text>
              ))}
            </ScrollView>
          )}
          <View style={styles.actions}>
            <Button
              label="Clear log"
              danger
              disabled={!log?.length}
              onPress={() =>
                action(async () => {
                  await w.io!.writeText(`${w.io!.privateRoot}/app-log.txt`, '');
                  setLog([]);
                }, 'Log cleared')
              }
            />
            <Button label="Close" onPress={() => setLog(null)} />
          </View>
        </Sheet>
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
  'Reset all folder links':
    'Forget every media folder and relinked location on this device.',
  'Check relations for all anime':
    'Link seasons of the same series across the whole library.',
  'View error log': 'Recent errors, newest first, for troubleshooting.',
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
  const verb = danger
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
    : label.startsWith('Check')
    ? 'Check'
    : label.startsWith('View')
    ? 'View'
    : 'Open';
  return (
    <HoverRow
      label={label}
      onPress={onPress}
      style={[styles.setting, width < 700 && styles.settingPhone]}
      hoverStyle={danger ? styles.settingDangerHover : styles.settingHover}
    >
      {hover => (
        <>
          <View style={styles.description}>
            <Text
              style={[
                ui.text,
                styles.label,
                hover && styles.labelLit,
                danger && ui.dangerText,
              ]}
            >
              {label}
            </Text>
            <Text style={ui.muted}>
              {explanations[label] ??
                (label.startsWith('Remove empty catalog')
                  ? 'It holds no titles; your open catalog stays as it is.'
                  : 'Switch to this saved local catalog.')}
            </Text>
          </View>
          <View style={styles.control}>
            <Text
              style={[
                styles.verb,
                hover && styles.verbLit,
                danger && ui.dangerText,
              ]}
            >
              {verb}
            </Text>
            <Icon
              name="forward"
              size={16}
              color={
                danger ? colors.danger : hover ? colors.accent : colors.muted
              }
            />
          </View>
        </>
      )}
    </HoverRow>
  );
}
const styles = StyleSheet.create({
  log: { maxHeight: 420 },
  logLine: { paddingVertical: 3 },
  column: { maxWidth: 860, width: '100%', alignSelf: 'center', gap: 40 },
  columnPhone: { gap: 32 },
  group: { gap: 16 },
  actions: { gap: 4 },
  // The highlight sits just outside the text column, so text stays aligned
  // with the headings while the highlighted box keeps its own breathing room.
  setting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginHorizontal: -16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  settingHover: { backgroundColor: colors.rowHover, borderColor: colors.line },
  settingDangerHover: { backgroundColor: '#2A1A1C', borderColor: '#5A3436' },
  settingPhone: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  description: { flex: 1, gap: 4 },
  label: { fontWeight: '600' },
  labelLit: { color: colors.mist },
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    minWidth: 92,
    minHeight: 32,
  },
  verb: { fontFamily, fontSize: 14, fontWeight: '600', color: colors.muted },
  verbLit: { color: colors.accent },
  danger: { gap: 16, marginTop: 24 },
});
