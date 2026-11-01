import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Button, Choice } from '../components/controls';
import { ui } from '../design/theme';
import { newId } from '../domain/catalog';
import VideoSurface from '../platform/VideoSurface';
import { playerCommand } from '../platform/nativePlayer';
import { CompletionGuard, PlaybackState } from '../services/progress';
type Item = { id: string; uri: string; name: string };
export function CustomPlayer({
  workspace: w,
  initialUri,
}: {
  workspace: Workspace;
  initialUri?: string;
}): React.JSX.Element {
  const [items, setItems] = useState<Item[]>(() =>
    initialUri
      ? [
          {
            id: newId('session'),
            uri: initialUri,
            name: decodeURIComponent(initialUri.split('/').pop() ?? 'Video'),
          },
        ]
      : [],
  );
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  const [state, setState] = useState<PlaybackState | null>(null);
  const progress = useRef(new Map<string, number>());
  const latest = useRef({ w, items });
  latest.current = { w, items };
  const item = items.find(v => v.id === activeId);
  useEffect(() => {
    if (!item) {
      return;
    }
    let live = true,
      polling = false;
    const guard = new CompletionGuard();
    playerCommand('open', {
      uri: item.uri,
      title: item.name,
      position: progress.current.get(item.id) ?? 0,
    }).catch(w.setError);
    const timer = setInterval(() => {
      if (polling) {
        return;
      }
      polling = true;
      playerCommand('state')
        .then(value => {
          if (!live) {
            return;
          }
          setState(value);
          progress.current.set(item.id, value.position);
          if (value.error) {
            latest.current.w.setError(value.error);
          }
          if (guard.shouldAdvance(value.ended)) {
            const all = latest.current.items;
            const next = all[all.findIndex(v => v.id === item.id) + 1];
            if (next) {
              setActiveId(next.id);
            }
          }
        })
        .catch(latest.current.w.setError)
        .finally(() => {
          polling = false;
        });
    }, 1000);
    return () => {
      live = false;
      clearInterval(timer);
      playerCommand('close').catch(() => undefined);
    };
    // Stable session identity controls media lifetime; other state is read from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);
  const action = (method: string, args: Record<string, unknown> = {}) => {
    playerCommand(method, args).then(setState).catch(w.setError);
  };
  const index = items.findIndex(v => v.id === activeId);
  const pick = () =>
    w.run(async () => {
      const uris = await w.io!.pickFiles('video');
      const additions = uris.map(uri => ({
        id: newId('session'),
        uri,
        name: decodeURIComponent(uri.split('/').pop() ?? 'Video'),
      }));
      setItems(list => [...list, ...additions]);
      if (!activeId && additions[0]) {
        setActiveId(additions[0].id);
      }
    }, 'Files added');
  return (
    <ScrollView contentContainerStyle={ui.page}>
      <Text accessibilityRole="header" style={ui.heading}>
        Custom Player
      </Text>
      <Text style={ui.muted}>
        A temporary playlist. Original files stay in place; this session is
        excluded from catalog transfers.
      </Text>
      <View style={ui.row}>
        <Button
          label="Choose videos"
          primary
          onPress={() => {
            pick().catch(w.setError);
          }}
        />
        <Button
          label="New session / Clear"
          onPress={() => {
            action('close');
            setActiveId(null);
            setItems([]);
            progress.current.clear();
          }}
        />
      </View>
      <VideoSurface />
      {item ? (
        <>
          <Text style={ui.subheading}>{item.name}</Text>
          <Text style={ui.muted}>
            {Math.floor(state?.position ?? 0)} /{' '}
            {Math.floor(state?.duration ?? 0)} seconds
          </Text>
          <View style={ui.row}>
            <Button
              label="Previous"
              disabled={index <= 0}
              onPress={() => setActiveId(items[index - 1]!.id)}
            />
            <Button
              label={state?.paused ? 'Play' : 'Pause'}
              onPress={() => action(state?.paused ? 'play' : 'pause')}
            />
            <Button
              label="Next"
              disabled={index < 0 || index >= items.length - 1}
              onPress={() => setActiveId(items[index + 1]!.id)}
            />
            <Button label="Fullscreen" onPress={() => action('fullscreen')} />
          </View>
          <Choice
            label="Speed"
            values={['0.5', '0.75', '1', '1.25', '1.5', '2']}
            value="1"
            onChange={value => action('rate', { rate: Number(value) })}
          />
          <Choice
            label="Audio"
            values={state?.audio.map(v => v.label) ?? []}
            value="Select audio"
            onChange={label =>
              action('audio', {
                id: state?.audio.find(v => v.label === label)?.id ?? '',
              })
            }
          />
          <Choice
            label="Subtitles"
            values={['Off', ...(state?.subtitles.map(v => v.label) ?? [])]}
            value="Select subtitles"
            onChange={label =>
              action('subtitle', {
                id: state?.subtitles.find(v => v.label === label)?.id ?? 'off',
              })
            }
          />
          <Button
            label="Import SRT / VTT"
            onPress={() => {
              w.run(async () => {
                const uri = (await w.io!.pickFiles('subtitle'))[0];
                if (uri) {
                  const text = await w.io!.readText(uri);
                  await playerCommand('importSubtitle', {
                    uri,
                    format: text.startsWith('WEBVTT') ? 'vtt' : 'srt',
                  });
                }
              }, 'Subtitles loaded').catch(w.setError);
            }}
          />
        </>
      ) : (
        <View style={ui.empty}>
          <Text style={ui.subheading}>Choose videos to begin</Text>
        </View>
      )}
      <Text style={ui.subheading}>Playlist · {items.length} files</Text>
      {items.map((media, at) => (
        <View key={media.id} style={ui.card}>
          <Text style={ui.text}>
            {at + 1}. {media.name}
            {media.id === activeId ? ' · Now playing' : ''}
          </Text>
          <View style={ui.row}>
            <Button label="Play" onPress={() => setActiveId(media.id)} />
            <Button
              label="Move up"
              disabled={at === 0}
              onPress={() =>
                setItems(list => {
                  const next = [...list];
                  [next[at - 1], next[at]] = [next[at]!, next[at - 1]!];
                  return next;
                })
              }
            />
            <Button
              label="Move down"
              disabled={at === items.length - 1}
              onPress={() =>
                setItems(list => {
                  const next = [...list];
                  [next[at], next[at + 1]] = [next[at + 1]!, next[at]!];
                  return next;
                })
              }
            />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
