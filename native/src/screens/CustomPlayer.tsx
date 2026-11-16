import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Button, Choice } from '../components/controls';
import { PanelPage } from '../components/Fade';
import { Icon, IconButton } from '../components/Icon';
import { DragList } from '../components/DragList';
import {
  colors,
  displayFamily,
  fontFamily,
  noFocusRing,
  ui,
} from '../design/theme';
import { useViewport } from '../design/viewport';
import { newId } from '../domain/catalog';
import VideoSurface from '../platform/VideoSurface';
import {
  VIDEO_EXTENSIONS,
  canDropFiles,
  hasExtension,
  useFileDrops,
} from '../platform/drops';
import { playerCommand } from '../platform/nativePlayer';
import { CompletionGuard, PlaybackState } from '../services/progress';
import {
  SavedPositions,
  clock,
  loadPositions,
  recordPosition,
  savePositions,
} from '../services/customPositions';
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
            name: fileLabel(initialUri).title,
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
  // Positions from earlier sessions, by file; loaded before the first video opens.
  const saved = useRef<SavedPositions>({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    (w.io ? loadPositions(w.io) : Promise.resolve({}))
      .then(value => {
        saved.current = value;
      })
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
    // Loaded once per visit; later saves keep the ref current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const persist = () => {
    const io = latest.current.w.io;
    if (io) {
      savePositions(io, saved.current).catch(() => undefined);
    }
  };
  const latest = useRef({ w, items });
  latest.current = { w, items };
  const item = items.find(v => v.id === activeId);
  useEffect(() => {
    if (!item || !loaded) {
      return;
    }
    let live = true,
      polling = false,
      lastSaved = Date.now(),
      last: PlaybackState | null = null;
    const guard = new CompletionGuard();
    const remember = (value: PlaybackState) => {
      if (value.ready) {
        recordPosition(
          saved.current,
          item.uri,
          value.position,
          value.duration,
          value.ended,
        );
      }
    };
    playerCommand('open', {
      uri: item.uri,
      title: item.name,
      position:
        progress.current.get(item.id) ?? saved.current[item.uri]?.position ?? 0,
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
          last = value;
          progress.current.set(item.id, value.position);
          if (value.ended || Date.now() - lastSaved >= 5000) {
            lastSaved = Date.now();
            remember(value);
            persist();
          }
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
      if (last) {
        remember(last);
        persist();
      }
      playerCommand('close').catch(() => undefined);
    };
    // Stable session identity controls media lifetime; other state is read from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, loaded]);
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
  const add = (uris: string[]) => {
    const additions = uris.map(uri => ({
      id: newId('session'),
      uri,
      name: fileLabel(uri).title,
    }));
    setItems(list => [...list, ...additions]);
    if (!activeId && additions[0]) {
      setActiveId(additions[0].id);
    }
  };
  const pick = () =>
    w.run(async () => add(await w.io!.pickFiles('video')), 'Files added');
  // Videos dragged onto the window join the playlist; anything else is ignored.
  useFileDrops(paths => {
    const videos = paths.filter(path => hasExtension(path, VIDEO_EXTENSIONS));
    if (videos.length) {
      add(videos);
      w.setError('');
    } else {
      w.setError('Only video files can be added to the playlist.');
    }
  });
  return (
    <PanelPage>
      <View style={styles.page}>
        <Text accessibilityRole="header" style={ui.heading}>
          Custom player
        </Text>
        <Text style={ui.muted}>
          A temporary playlist. Original files stay in place and each one
          resumes where you left it; none of this is part of catalog transfers.
          {canDropFiles ? ' You can also drop videos onto this window.' : ''}
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
                <Text style={[ui.muted, styles.time]}>
                  {clock(state?.position ?? 0)} / {clock(state?.duration ?? 0)}
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
            <View style={styles.playlistHead}>
              <Text style={ui.subheading}>Playlist</Text>
              <Text style={ui.muted}>
                {items.length === 1 ? '1 file' : `${items.length} files`}
              </Text>
            </View>
            <DragList
              ids={items.map(media => media.id)}
              onReorder={order =>
                setItems(list =>
                  order.map(id => list.find(media => media.id === id)!),
                )
              }
              renderItem={(id, at) => {
                const media = items.find(value => value.id === id)!;
                const move = (by: 1 | -1) =>
                  setItems(list => {
                    const next = [...list];
                    [next[at], next[at + by]] = [next[at + by]!, next[at]!];
                    return next;
                  });
                return (
                  <PlaylistRow
                    key={media.id}
                    number={at + 1}
                    uri={media.uri}
                    playing={media.id === activeId}
                    resumeAt={saved.current[media.uri]?.position ?? null}
                    first={at === 0}
                    last={at === items.length - 1}
                    onPlay={() => setActiveId(media.id)}
                    onMove={move}
                  />
                );
              }}
            />
          </View>
        </View>
      </View>
    </PanelPage>
  );
}

/** A file's own name for display: no folders, no extension, underscores as spaces. */
export function fileLabel(uri: string): { title: string; kind: string } {
  let name = uri.split(/[\\/]/).pop() ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // A literal % in a Windows file name is fine as it is.
  }
  const dot = name.lastIndexOf('.');
  const kind = dot > 0 ? name.slice(dot + 1).toUpperCase() : '';
  const title = (dot > 0 ? name.slice(0, dot) : name)
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { title: title || 'Video', kind };
}

function PlaylistRow({
  number,
  uri,
  playing,
  resumeAt,
  first,
  last,
  onPlay,
  onMove,
}: {
  number: number;
  uri: string;
  playing: boolean;
  resumeAt: number | null;
  first: boolean;
  last: boolean;
  onPlay: () => void;
  onMove: (by: 1 | -1) => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const { title, kind } = fileLabel(uri);
  const status = playing
    ? 'Now playing'
    : resumeAt !== null
    ? `Resumes at ${clock(resumeAt)}`
    : kind;
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="button"
      accessibilityLabel={`${number}. ${title}, ${status || 'Not started'}`}
      accessibilityState={{ selected: playing }}
      {...{ tooltip: title }}
      onPress={onPlay}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={[
        styles.row,
        hover && !playing && styles.rowHover,
        playing && styles.rowPlaying,
      ]}
    >
      <Text style={[styles.rowNumber, playing && styles.rowNumberPlaying]}>
        {number}
      </Text>
      <View style={styles.rowCopy}>
        <Text
          numberOfLines={3}
          style={[styles.rowTitle, (hover || playing) && styles.rowTitleLit]}
        >
          {title}
        </Text>
        {status !== '' && (
          <Text
            numberOfLines={1}
            style={[styles.rowStatus, playing && styles.rowStatusPlaying]}
          >
            {status}
          </Text>
        )}
      </View>
      {!playing && (
        <IconButton icon="play" label="Play" size={16} onPress={onPlay} />
      )}
      <View style={styles.rowMove}>
        <IconButton
          icon="up"
          label="Move up"
          size={12}
          disabled={first}
          onPress={() => onMove(-1)}
        />
        <IconButton
          icon="down"
          label="Move down"
          size={12}
          disabled={last}
          onPress={() => onMove(1)}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  time: { fontVariant: ['tabular-nums'] },
  playlistHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.raised,
  },
  rowHover: { borderColor: colors.accent, backgroundColor: colors.hover },
  rowPlaying: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  rowNumber: {
    fontFamily: displayFamily,
    fontSize: 20,
    fontWeight: '700',
    minWidth: 22,
    textAlign: 'center',
    color: colors.muted,
    fontVariant: ['tabular-nums'],
  },
  rowNumberPlaying: { color: colors.accent },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: {
    fontFamily,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.text,
  },
  rowTitleLit: { color: colors.mist },
  rowStatus: { fontFamily, fontSize: 12, color: colors.muted },
  rowStatusPlaying: { color: colors.accent },
  // Stacked, so the name keeps most of the row.
  rowMove: { alignItems: 'center', marginVertical: -6 },
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
  playlist: { width: '34%', minWidth: 300, gap: 16 },
  playlistPhone: { width: '100%' },
});
