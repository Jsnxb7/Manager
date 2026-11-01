import { Cover, coverUri } from '../components/Cover';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import {
  Button,
  HoverRow,
  ProgressBar,
  Sheet,
  TextButton,
} from '../components/controls';
import { PanelPage } from '../components/Fade';
import { IconButton } from '../components/Icon';
import { DragList } from '../components/DragList';
import { MediaResolver } from '../services/media';
import { colors, fontFamily, ui, noFocusRing } from '../design/theme';
import { useViewport } from '../design/viewport';
import {
  clearWatchedQueue,
  queueTarget,
  reorderQueue,
  targetRoute,
} from '../services/playback';
import { watchedPercent } from '../services/library';
export function QueueContent({
  workspace: w,
  navigate,
  compact = false,
}: {
  workspace: Workspace;
  navigate: (route: Route) => void;
  compact?: boolean;
}): React.JSX.Element {
  const { width } = useViewport();
  // The drawer is as narrow as a phone, so it shares the stacked row layout.
  const phone = width < 700 || compact;
  const [focused, setFocused] = useState<string | null>(null);
  const ids = w.catalog!.queue;
  const resolver = useMemo(
    () => (w.io ? new MediaResolver(w.io) : null),
    [w.io],
  );
  const entries = w.catalog!.entries;
  const [missing, setMissing] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let live = true;
    setMissing({});
    // Check one title at a time after the rows render, never block browsing.
    const check = async () => {
      if (!resolver) {
        return;
      }
      for (const id of ids) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (!live) {
          return;
        }
        const entry = entries.find(value => value.id === id);
        if (!entry) {
          continue;
        }
        try {
          const files = await resolver.check(entry, w.settings);
          if (!live) {
            return;
          }
          setMissing(previous => ({
            ...previous,
            [id]:
              !entry.episodes.length ||
              Object.values(files).some(file => file.state !== 'available'),
          }));
        } catch {
          if (live) {
            setMissing(previous => ({ ...previous, [id]: true }));
          }
        }
      }
    };
    check().catch(w.setError);
    return () => {
      live = false;
    };
  }, [ids, entries, resolver, w.settings, w.setError]);
  const last = w.catalog!.legacy.lastUse as { entryId?: string } | undefined;
  const play = (id: string) => {
    const target = queueTarget(w.catalog!, id);
    if (target) {
      navigate(targetRoute(target));
    } else {
      w.setError('This queued title has no playable episode records.');
    }
  };
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
      {!compact && (
        <Text accessibilityRole="header" style={ui.heading}>
          Queue
        </Text>
      )}
      <Text style={ui.muted}>
        {ids.length} titles queued
        {ids.length >= 2
          ? `, first: ${
              w.catalog!.entries.find(e => e.id === ids[0])!.title
            }, last: ${
              w.catalog!.entries.find(e => e.id === ids[ids.length - 1])!.title
            }`
          : ''}
      </Text>
      <View style={ui.row}>
        <Button
          label="Start queue"
          primary
          disabled={!ids.length}
          onPress={() => play(ids[0]!)}
        />
        <Button
          label="Clear watched"
          disabled={!ids.length}
          onPress={() => action(() => w.mutate(clearWatchedQueue))}
        />
        <Button
          label="Clear queue"
          danger
          disabled={!ids.length}
          onPress={() =>
            confirm(
              'Clear queue?',
              'Your library and video files stay unchanged.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Clear queue',
                  onPress: () =>
                    action(() =>
                      w.mutate(c => {
                        c.queue = [];
                      }),
                    ),
                },
              ],
            )
          }
        />
      </View>
      {ids.length === 0 && (
        <View style={ui.empty}>
          <Text style={ui.subheading}>Your queue is empty</Text>
          <IconButton
            icon="search"
            label="Browse anime"
            onPress={() => navigate({ name: 'library', sectionId: 'anime' })}
          />
        </View>
      )}
      <DragList
        ids={ids}
        onReorder={order => action(() => w.mutate(c => reorderQueue(c, order)))}
        renderItem={(id, index) => {
          const e = w.catalog!.entries.find(item => item.id === id)!;
          return (
            <View key={id}>
              <View style={ui.rule} />
              <HoverRow style={last?.entryId === id && styles.selected}>
                {hover => (
                  <Pressable
                    {...noFocusRing}
                    focusable={false}
                    onFocus={() => setFocused(id)}
                    onBlur={() => setFocused(null)}
                    style={[styles.entry, phone && styles.entryPhone]}
                  >
                    <View
                      style={[styles.identity, phone && styles.identityPhone]}
                    >
                      <Text style={[ui.muted, styles.position]}>
                        {index + 1}
                      </Text>
                      <View style={styles.cover}>
                        <Cover
                          title={e.title}
                          uri={e.cover ? coverUri(e, w.io?.privateRoot) : null}
                        />
                      </View>
                      <View style={styles.details}>
                        <Text
                          style={[
                            ui.text,
                            last?.entryId === id && styles.current,
                          ]}
                        >
                          {e.title}
                        </Text>
                        {last?.entryId === id && (
                          <Text style={[ui.small, styles.current]}>
                            Last played
                          </Text>
                        )}
                        <Text style={ui.muted}>
                          {e.season}, {ids.length - index - 1}{' '}
                          {ids.length - index - 1 === 1 ? 'title' : 'titles'}{' '}
                          after this
                        </Text>
                        <Text style={ui.small}>
                          {Math.round(watchedPercent(e))}% watched,{' '}
                          {e.episodes.filter(episode => episode.watched).length}
                          /{e.episodes.length} episodes completed
                        </Text>
                        {missing[id] && (
                          <Text style={[ui.small, { color: colors.danger }]}>
                            Files missing
                          </Text>
                        )}
                        <ProgressBar
                          label="Title completion"
                          value={watchedPercent(e)}
                        />
                      </View>
                    </View>
                    <View
                      style={[styles.actions, phone && styles.actionsPhone]}
                    >
                      <IconButton
                        icon="play"
                        label="Play"
                        onPress={() => play(id)}
                      />
                      <View
                        style={[
                          styles.actions,
                          Platform.OS === 'windows' &&
                            !phone &&
                            !hover &&
                            focused !== id &&
                            styles.hidden,
                        ]}
                      >
                        <IconButton
                          icon="top"
                          label="Top"
                          disabled={index === 0}
                          onPress={() =>
                            action(() =>
                              w.mutate(c =>
                                reorderQueue(c, [
                                  id,
                                  ...c.queue.filter(v => v !== id),
                                ]),
                              ),
                            )
                          }
                        />
                        <IconButton
                          icon="up"
                          label="Up"
                          disabled={index === 0}
                          onPress={() =>
                            action(() =>
                              w.mutate(c => {
                                const order = [...c.queue];
                                const at = order.indexOf(id);
                                if (at <= 0) {
                                  return;
                                }
                                [order[at - 1], order[at]] = [
                                  order[at]!,
                                  order[at - 1]!,
                                ];
                                reorderQueue(c, order);
                              }),
                            )
                          }
                        />
                        <IconButton
                          icon="down"
                          label="Down"
                          disabled={index === ids.length - 1}
                          onPress={() =>
                            action(() =>
                              w.mutate(c => {
                                const order = [...c.queue];
                                const at = order.indexOf(id);
                                if (at < 0 || at >= order.length - 1) {
                                  return;
                                }
                                [order[at], order[at + 1]] = [
                                  order[at + 1]!,
                                  order[at]!,
                                ];
                                reorderQueue(c, order);
                              }),
                            )
                          }
                        />
                        <IconButton
                          icon="trash"
                          color={colors.danger}
                          label="Remove"
                          onPress={() =>
                            action(() =>
                              w.mutate(c => {
                                c.queue = c.queue.filter(v => v !== id);
                              }),
                            )
                          }
                        />
                      </View>
                    </View>
                  </Pressable>
                )}
              </HoverRow>
            </View>
          );
        }}
      />

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
export function Queue(props: {
  workspace: Workspace;
  navigate: (route: Route) => void;
}): React.JSX.Element {
  return (
    <PanelPage width={1180}>
      <QueueContent {...props} />
    </PanelPage>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16 },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 20,
  },
  entryPhone: { flexDirection: 'column', alignItems: 'stretch' },
  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  identityPhone: { flex: undefined },
  hidden: { opacity: 0 },
  position: { fontFamily, width: 24, textAlign: 'right' },
  cover: { width: 56 },
  details: { flex: 1, minWidth: 0, gap: 6 },
  current: { fontFamily, color: colors.accent },
  selected: { backgroundColor: colors.accentSoft },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    justifyContent: 'flex-end',
    paddingVertical: 8,
  },
  actionsPhone: { justifyContent: 'flex-start', paddingLeft: 36 },
});
