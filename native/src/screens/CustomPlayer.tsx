import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Button, Choice } from '../components/controls';
import { PanelPage } from '../components/Fade';
import { Icon, IconButton } from '../components/Icon';
import { DragList } from '../components/DragList';
import { colors, fontFamily, ui } from '../design/theme';
import { useViewport } from '../design/viewport';
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
  const { width } = useViewport();
  const phone = width < 700;
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
  const [speed, setSpeed] = useState('1');
  const [audio, setAudio] = useState('');
  const [subtitle, setSubtitle] = useState('Off');
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
          if (value.request) {
            const all = latest.current.items;
            const at = all.findIndex(v => v.id === item.id);
            const other = all[at + (value.request === 'next' ? 1 : -1)];
            if (other) {
              setActiveId(other.id);
            }
            return;
          }
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
  useEffect(() => {
    playerCommand('nav', {
      previous: index > 0,
      next: index >= 0 && index < items.length - 1,
    }).catch(() => undefined);
  }, [index, items.length]);
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
    <PanelPage>
      <View style={styles.page}>
        <Text accessibilityRole="header" style={ui.heading}>
          Custom player
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
          <IconButton
            icon="reset"
            label="New session / Clear"
            onPress={() => {
              action('close');
              setActiveId(null);
              setItems([]);
              progress.current.clear();
            }}
          />
        </View>
        <View style={[styles.layout, phone && styles.stacked]}>
          <View style={[styles.videoColumn, phone && styles.videoColumnPhone]}>
            {item ? (
              <View style={styles.video}>
                <VideoSurface title="" detail="" />
              </View>
            ) : (
              <View style={styles.empty}>
                <Icon name="player" size={40} color={colors.muted} />
                <Text style={ui.muted}>Choose videos to begin</Text>
              </View>
            )}
            {item ? (
              <>
                <Text style={ui.subheading}>{item.name}</Text>
                <Text style={ui.muted}>
                  {Math.floor(state?.position ?? 0)} /{' '}
                  {Math.floor(state?.duration ?? 0)} seconds
                </Text>
                {Platform.OS !== 'windows' && (
                  <View style={ui.row}>
                    <IconButton
                      icon="back"
                      label="Previous"
                      disabled={index <= 0}
                      onPress={() => setActiveId(items[index - 1]!.id)}
                    />
                    <IconButton
                      icon={state?.paused ? 'play' : 'pause'}
                      label={state?.paused ? 'Play' : 'Pause'}
                      onPress={() => action(state?.paused ? 'play' : 'pause')}
                    />
                    <IconButton
                      icon="forward"
                      label="Next"
                      disabled={index < 0 || index >= items.length - 1}
                      onPress={() => setActiveId(items[index + 1]!.id)}
                    />
                    <IconButton
                      icon="fullscreen"
                      label="Fullscreen"
                      onPress={() => action('fullscreen')}
                    />
                  </View>
                )}
                <View style={styles.tracks}>
                  <Choice
                    label="Playback speed"
                    inline
                    display={`${speed}x`}
                    values={['0.5', '0.75', '1', '1.25', '1.5', '2']}
                    value={speed}
                    onChange={value => {
                      setSpeed(value);
                      action('rate', { rate: Number(value) });
                    }}
                  />
                  <Choice
                    label="Audio"
                    inline
                    values={state?.audio.map(v => v.label) ?? []}
                    value={audio}
                    display={
                      state?.audio.some(track => track.label === audio)
                        ? audio
                        : state?.audio[0]?.label ?? 'None'
                    }
                    onChange={label => {
                      setAudio(label);
                      action('audio', {
                        id: state?.audio.find(v => v.label === label)?.id ?? '',
                      });
                    }}
                  />
                  <Choice
                    label="Subtitles"
                    inline
                    values={[
                      'Off',
                      ...(state?.subtitles.map(v => v.label) ?? []),
                    ]}
                    value={subtitle}
                    display={
                      subtitle === 'Off' ||
                      state?.subtitles.some(track => track.label === subtitle)
                        ? subtitle
                        : 'Off'
                    }
                    onChange={label => {
                      setSubtitle(label);
                      action('subtitle', {
                        id:
                          state?.subtitles.find(v => v.label === label)?.id ??
                          'off',
                      });
                    }}
                  />
                  <IconButton
                    icon="captions"
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
                </View>
              </>
            ) : null}
          </View>
          <View style={[styles.playlist, phone && styles.playlistPhone]}>
            <Text style={ui.subheading}>Playlist, {items.length} files</Text>
            <DragList
              ids={items.map(media => media.id)}
              onReorder={order =>
                setItems(list =>
                  order.map(id => list.find(media => media.id === id)!),
                )
              }
              renderItem={(id, at) => {
                const media = items.find(value => value.id === id)!;
                return (
                  <View key={media.id}>
                    <View style={ui.rule} />
                    <View style={styles.file}>
                      <Text
                        style={[
                          ui.text,
                          media.id === activeId && styles.current,
                        ]}
                      >
                        {at + 1}. {media.name}
                        {media.id === activeId ? ', Now playing' : ''}
                      </Text>
                      <View style={ui.row}>
                        <IconButton
                          icon="play"
                          label="Play"
                          onPress={() => setActiveId(media.id)}
                        />
                        <IconButton
                          icon="up"
                          label="Move up"
                          disabled={at === 0}
                          onPress={() =>
                            setItems(list => {
                              const next = [...list];
                              [next[at - 1], next[at]] = [
                                next[at]!,
                                next[at - 1]!,
                              ];
                              return next;
                            })
                          }
                        />
                        <IconButton
                          icon="down"
                          label="Move down"
                          disabled={at === items.length - 1}
                          onPress={() =>
                            setItems(list => {
                              const next = [...list];
                              [next[at], next[at + 1]] = [
                                next[at + 1]!,
                                next[at]!,
                              ];
                              return next;
                            })
                          }
                        />
                      </View>
                    </View>
                  </View>
                );
              }}
            />
          </View>
        </View>
      </View>
    </PanelPage>
  );
}

const styles = StyleSheet.create({
  page: { gap: 20 },
  layout: { flexDirection: 'row', alignItems: 'flex-start', gap: 32 },
  stacked: { flexDirection: 'column', gap: 32 },
  videoColumn: { flex: 1, minWidth: 0, gap: 16 },
  videoColumnPhone: { flex: undefined, width: '100%' },
  video: { minHeight: 240, justifyContent: 'center' },
  empty: {
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  tracks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    columnGap: 32,
    rowGap: 18,
    marginTop: 26,
    paddingTop: 20,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  playlist: { width: '30%', gap: 16 },
  playlistPhone: { width: '100%' },
  file: { paddingVertical: 16, gap: 12 },
  current: { fontFamily, color: colors.mist },
});
