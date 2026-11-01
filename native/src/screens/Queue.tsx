import { Cover } from '../components/Cover';
import React from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import { Button, ProgressBar } from '../components/controls';
import { ui } from '../design/theme';
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
  const ids = w.catalog!.queue;
  const last = w.catalog!.legacy.lastUse as { entryId?: string } | undefined;
  const play = (id: string) => {
    const target = queueTarget(w.catalog!, id);
    if (target) {
      navigate(targetRoute(target));
    } else {
      w.setError('This queued title has no playable episode records.');
    }
  };
  const action = (job: () => Promise<void>) => {
    w.run(job).catch(w.setError);
  };
  return (
    <View style={compact ? ui.card : ui.page}>
      <Text
        accessibilityRole="header"
        style={compact ? ui.subheading : ui.heading}
      >
        Queue
      </Text>
      <Text style={ui.muted}>{ids.length} titles queued</Text>
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
            Alert.alert(
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
          <Button
            label="Browse anime"
            onPress={() => navigate({ name: 'library', sectionId: 'anime' })}
          />
        </View>
      )}
      {ids.map((id, index) => {
        const e = w.catalog!.entries.find(item => item.id === id)!;
        return (
          <View key={id} style={ui.card}>
            {e.cover && (
              <View style={ui.thumbnail}>
                <Cover
                  title={e.title}
                  uri={`file://${w.io!.privateRoot}/${e.cover}`}
                />
              </View>
            )}
            <Text style={ui.text}>
              {index + 1}. {e.title}
              {last?.entryId === id ? ' · Now playing' : ''}
            </Text>
            <Text style={ui.muted}>
              {e.season} · {ids.length - index - 1} titles after this
            </Text>
            <ProgressBar label="Title completion" value={watchedPercent(e)} />
            <View style={ui.row}>
              <Button label="Play" primary onPress={() => play(id)} />
              <Button
                label="Top"
                disabled={index === 0}
                onPress={() =>
                  action(() =>
                    w.mutate(c =>
                      reorderQueue(c, [id, ...c.queue.filter(v => v !== id)]),
                    ),
                  )
                }
              />
              <Button
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
                      [order[at - 1], order[at]] = [order[at]!, order[at - 1]!];
                      reorderQueue(c, order);
                    }),
                  )
                }
              />
              <Button
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
                      [order[at], order[at + 1]] = [order[at + 1]!, order[at]!];
                      reorderQueue(c, order);
                    }),
                  )
                }
              />
              <Button
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
        );
      })}
    </View>
  );
}
export function Queue(props: {
  workspace: Workspace;
  navigate: (route: Route) => void;
}): React.JSX.Element {
  return (
    <ScrollView>
      <QueueContent {...props} />
    </ScrollView>
  );
}
