import { Cover, coverUri } from './Cover';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import {
  Button,
  Field,
  HoverRow,
  ProgressBar,
  Sheet,
  TextButton,
} from './controls';
import { IconButton } from './Icon';
import { DragList } from './DragList';
import { colors, fontFamily, ui } from '../design/theme';
import { useViewport } from '../design/viewport';
import {
  addRelation,
  relationFor,
  removeRelation,
  reorderRelation,
  scanRelations,
} from '../services/relations';
import { watchedPercent } from '../services/library';
export function Relations({
  workspace: w,
  entryId,
  navigate,
}: {
  workspace: Workspace;
  entryId: string;
  navigate: (route: Route) => void;
}): React.JSX.Element {
  const { width } = useViewport();
  const phone = width < 700;
  const group = relationFor(w.catalog!, entryId);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [query, setQuery] = useState('');
  const order = draft ?? group?.entryIds ?? [entryId];
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
  const action = (job: () => Promise<void>) => {
    w.run(job).catch(w.setError);
  };
  return (
    <View style={styles.content}>
      <Text style={ui.subheading}>Related Anime</Text>
      <Text style={ui.muted}>
        Arrange seasons, specials and movies in playback order.
      </Text>
      <View style={ui.row}>
        {draft ? (
          <>
            <Button
              label="Save order"
              primary
              onPress={() =>
                action(async () => {
                  await w.mutate(c => reorderRelation(c, entryId, draft));
                  setDraft(null);
                })
              }
            />
            <TextButton label="Cancel" onPress={() => setDraft(null)} />
          </>
        ) : (
          <TextButton
            label="Edit order"
            disabled={!group}
            onPress={() => setDraft([...order])}
          />
        )}
        <TextButton
          label="Reset default"
          disabled={!group || !!draft}
          onPress={() =>
            action(() => w.mutate(c => reorderRelation(c, entryId, null)))
          }
        />
        <TextButton
          label="Check relations"
          disabled={!!draft}
          onPress={() => action(() => w.mutate(c => scanRelations(c, entryId)))}
        />
      </View>
      <Text style={ui.small}>
        {group?.mode === 'custom'
          ? 'Custom watch order'
          : 'Automatic watch order'}
      </Text>
      <DragList
        ids={order}
        disabled={!draft}
        onReorder={setDraft}
        renderItem={(id, index) => {
          const e = w.catalog!.entries.find(v => v.id === id)!;
          return (
            <View key={id} style={styles.divided}>
              <HoverRow
                style={[
                  styles.entry,
                  phone && styles.entryPhone,
                  id === entryId && styles.selected,
                ]}
              >
                <View style={[styles.identity, phone && styles.identityPhone]}>
                  <Text
                    style={[
                      ui.subheading,
                      styles.position,
                      id === entryId && styles.current,
                    ]}
                  >
                    {index + 1}
                  </Text>
                  <View style={styles.cover}>
                    <Cover
                      title={e.title}
                      uri={e.cover ? coverUri(e, w.io?.privateRoot) : null}
                    />
                  </View>
                  <View style={styles.copy}>
                    <HoverRow
                      label="Open"
                      onPress={() => navigate({ name: 'details', animeId: id })}
                    >
                      <Text style={[ui.text, id === entryId && styles.current]}>
                        {e.title}
                      </Text>
                    </HoverRow>
                    {id === entryId && (
                      <Text style={[ui.small, styles.current]}>Current</Text>
                    )}
                    <Text style={ui.small}>
                      {e.season}, {e.status.replace('_', ' ')},{' '}
                      {Math.round(watchedPercent(e))}% completed,{' '}
                      {e.episodes.filter(episode => episode.watched).length}/
                      {e.episodes.length} episodes completed
                    </Text>
                    <View style={styles.progress}>
                      <ProgressBar
                        label={`${e.title} completion`}
                        value={watchedPercent(e)}
                      />
                    </View>
                  </View>
                </View>
                <View style={ui.row}>
                  {draft && (
                    <>
                      <IconButton
                        icon="up"
                        label="Move up"
                        disabled={index === 0}
                        onPress={() =>
                          setDraft(items => {
                            const next = [...items!];
                            [next[index - 1], next[index]] = [
                              next[index]!,
                              next[index - 1]!,
                            ];
                            return next;
                          })
                        }
                      />
                      <IconButton
                        icon="down"
                        label="Move down"
                        disabled={index === order.length - 1}
                        onPress={() =>
                          setDraft(items => {
                            const next = [...items!];
                            [next[index], next[index + 1]] = [
                              next[index + 1]!,
                              next[index]!,
                            ];
                            return next;
                          })
                        }
                      />
                    </>
                  )}
                  {id !== entryId && (
                    <IconButton
                      icon="trash"
                      color={colors.danger}
                      label="Remove relation"
                      disabled={!!draft}
                      onPress={() =>
                        confirm(
                          'Remove relation?',
                          'Automatic checks will respect this removal.',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Remove',
                              onPress: () =>
                                action(() =>
                                  w.mutate(c => removeRelation(c, entryId, id)),
                                ),
                            },
                          ],
                        )
                      }
                    />
                  )}
                </View>
              </HoverRow>
            </View>
          );
        }}
      />
      <Field
        label="Find local anime to add"
        value={query}
        onChange={setQuery}
      />
      {query.trim().length >= 2 &&
        w
          .catalog!.entries.filter(
            e =>
              e.kind === 'anime' &&
              !order.includes(e.id) &&
              `${e.title} ${e.season}`
                .toLowerCase()
                .includes(query.toLowerCase()),
          )
          .slice(0, 12)
          .map(e => (
            <HoverRow key={e.id} style={[styles.divided, styles.entry]}>
              <View style={styles.cover}>
                <Cover
                  title={e.title}
                  uri={e.cover ? coverUri(e, w.io?.privateRoot) : null}
                />
              </View>
              <View style={styles.copy}>
                <TextButton
                  disabled={!!draft}
                  label={`Add ${e.title} (${e.season})`}
                  onPress={() => {
                    const add = () =>
                      action(async () => {
                        await w.mutate(c => addRelation(c, entryId, e.id));
                        setQuery('');
                      });
                    const otherGroup = relationFor(w.catalog!, e.id);
                    if (otherGroup && otherGroup.id !== group?.id) {
                      confirm(
                        'Merge relation groups?',
                        `Adding ${e.title} will merge its relation group with this title's group. All titles in both groups will be related.`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Merge groups', onPress: add },
                        ],
                      );
                    } else {
                      add();
                    }
                  }}
                />
              </View>
            </HoverRow>
          ))}

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
  );
}

const styles = StyleSheet.create({
  content: { gap: 12 },
  divided: { borderBottomWidth: 1, borderColor: colors.line },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 8,
  },
  entryPhone: { flexDirection: 'column', alignItems: 'stretch' },
  identity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  identityPhone: { flex: undefined },
  position: { fontFamily, width: 28, textAlign: 'right' },
  cover: { width: 44 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  progress: { maxWidth: 320, marginTop: 4 },
  current: { fontFamily, color: colors.accent },
  selected: { backgroundColor: colors.accentSoft },
});
