import React, { useEffect, useRef, useState } from 'react';
import {
  AppState,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import { Button, Choice, ProgressBar } from '../components/controls';
import { coverUri } from '../components/Cover';
import { FadeEdges, PanelPage } from '../components/Fade';
import { Icon, IconButton } from '../components/Icon';
import {
  colors,
  displayFamily,
  fontFamily,
  ui,
  noFocusRing,
} from '../design/theme';
import { useViewport } from '../design/viewport';
import { MediaResolver } from '../services/media';
import {
  CompletionGuard,
  PlaybackState,
  saveProgress,
} from '../services/progress';
import { setWatched } from '../services/mutations';
import { playerCommand } from '../platform/nativePlayer';
import VideoSurface from '../platform/VideoSurface';
import {
  PlaybackTarget,
  resolveTarget,
  targetRoute,
} from '../services/playback';

export function Player({
  workspace: w,
  animeId,
  episodeId,
  resume,
  queueAnchor,
  navigate,
}: {
  workspace: Workspace;
  animeId: string;
  episodeId: string;
  resume: boolean;
  queueAnchor: string | null;
  navigate: (route: Route) => void;
}): React.JSX.Element {
  const entry = w.catalog!.entries.find(e => e.id === animeId);
  const ep = entry?.episodes.find(e => e.id === episodeId);
  const [state, setState] = useState<PlaybackState | null>(null);
  const [seek, setSeek] = useState('');
  const [speed, setSpeed] = useState('1');
  const [audioLabel, setAudioLabel] = useState('Default');
  const [subtitleLabel, setSubtitleLabel] = useState('Off');
  const [volume, setVolume] = useState(1);
  const { width } = useViewport();
  const phone = width < 700;
  // Below this the side covers would squeeze the video, so they move under it.
  const wide = width >= 1100;
  const [failed, setFailed] = useState('');
  const latest = useRef(w);
  latest.current = w;
  const lastState = useRef<PlaybackState | null>(null);
  const openUri = useRef('');
  useEffect(() => {
    if (!entry || !ep) {
      return;
    }
    let live = true,
      polling = false,
      lastSaved = Date.now();
    const completion = new CompletionGuard();
    const save = async (value: PlaybackState) => {
      if (value.ready && latest.current.repo) {
        latest.current.setCatalog(
          await latest.current.repo.mutate(c =>
            saveProgress(
              c,
              animeId,
              episodeId,
              value.position,
              value.duration,
              value.ended,
            ),
          ),
        );
      }
    };
    const poll = async () => {
      if (polling || !live) {
        return;
      }
      polling = true;
      try {
        const value = await playerCommand('state');
        lastState.current = value;
        const catalogNow = latest.current.catalog;
        if (live && value.request && catalogNow) {
          const target = resolveTarget(
            catalogNow,
            animeId,
            episodeId,
            value.request === 'next' ? 1 : -1,
            queueAnchor,
          );
          if (target) {
            navigate(targetRoute(target));
          }
          return;
        }
        if (live) {
          setState(value);
        }
        if (value.error) {
          throw new Error(value.error);
        }
        if (completion.shouldAdvance(value.ended)) {
          await save(value).catch(latest.current.setError);
          const catalog = latest.current.catalog;
          const next = catalog
            ? resolveTarget(catalog, animeId, episodeId, 1, queueAnchor)
            : null;
          if (live && next) {
            navigate(targetRoute(next));
          }
        } else if (
          value.ready &&
          (Date.now() - lastSaved >= 5000 ||
            (stateChanged(value) && value.paused))
        ) {
          lastSaved = Date.now();
          await save(value);
        }
      } catch (error) {
        if (live) {
          latest.current.setError(String(error));
        }
      } finally {
        polling = false;
      }
    };
    let wasPaused = false;
    const stateChanged = (value: PlaybackState) => {
      const changed = wasPaused !== value.paused;
      wasPaused = value.paused;
      return changed;
    };
    const start = async () => {
      const result = await new MediaResolver(latest.current.io!).check(
        entry,
        latest.current.settings,
      );
      const file = result[episodeId];
      if (!file || file.state !== 'available') {
        throw new Error(
          file
            ? file.message
            : 'Local video is unavailable. Locate it in Anime Details.',
        );
      }
      if (!live) {
        return;
      }
      openUri.current = file.uri;
      if (!resume) {
        await latest.current.mutate(c =>
          setWatched(c, animeId, false, episodeId),
        );
      }
      const position = resume
        ? latest.current.catalog?.progress[episodeId]?.currentTime ?? 0
        : 0;
      await playerCommand('open', {
        uri: file.uri,
        position,
        title: `${entry.title} · Episode ${ep.number}`,
      });
    };
    start().catch(error => {
      if (live) {
        setFailed(String(error).replace(/^Error: /, ''));
      }
    });
    const timer = setInterval(() => {
      poll().catch(latest.current.setError);
    }, 1000);
    const subscription = AppState.addEventListener('change', status => {
      if (status !== 'active' && lastState.current) {
        save(lastState.current).catch(latest.current.setError);
      }
    });
    return () => {
      live = false;
      clearInterval(timer);
      subscription.remove();
      const value = lastState.current;
      if (Platform.OS !== 'android') {
        playerCommand('close').catch(latest.current.setError);
      }
      if (value) {
        save(value).catch(latest.current.setError);
      }
    };
    // The session follows stable identity; live workspace state is read from latest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeId, episodeId, resume, queueAnchor]);
  const action = (method: string, args: Record<string, unknown> = {}) => {
    playerCommand(method, args).then(setState).catch(w.setError);
  };
  const resolveTargetSafe = (direction: 1 | -1) =>
    resolveTarget(w.catalog!, animeId, episodeId, direction, queueAnchor);
  const previous = entry && ep ? resolveTargetSafe(-1) : null;
  const next = entry && ep ? resolveTargetSafe(1) : null;
  useEffect(() => {
    playerCommand('nav', {
      previous: !!previous,
      next: !!next,
    }).catch(() => undefined);
  }, [!!previous, !!next]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!entry || !ep) {
    return (
      <PanelPage>
        <Text style={ui.heading}>Episode no longer exists</Text>
      </PanelPage>
    );
  }
  const neighbour = (target: PlaybackTarget | null) => {
    const item = target
      ? w.catalog!.entries.find(e => e.id === target.entryId)
      : null;
    return {
      uri: item?.cover ? coverUri(item, w.io?.privateRoot) : null,
      label:
        target && item
          ? item.id === animeId
            ? `Episode ${
                item.episodes.find(e => e.id === target.episodeId)?.number ?? ''
              }`
            : item.title
          : '',
    };
  };
  return (
    <PanelPage flush>
      {/* Keyed by width: stale text measurements after a resize would clip these,
          and the video itself must not remount. */}
      <Text
        key={`title-${width}`}
        accessibilityRole="header"
        numberOfLines={2}
        style={[styles.title, phone && styles.titlePhone]}
      >
        {entry.title}
      </Text>
      <Text key={`episode-${width}`} style={[ui.muted, styles.episode]}>
        {[
          entry.season,
          `Episode ${ep.number}`,
          ep.title === `Episode ${ep.number}` ? '' : ep.title,
        ]
          .filter(Boolean)
          .join(', ')}
      </Text>
      <View style={wide ? styles.stage : undefined}>
        {wide && (
          <SideEpisode
            direction="Previous"
            target={previous}
            {...neighbour(previous)}
            onPress={() => previous && navigate(targetRoute(previous))}
          />
        )}
        <View style={wide ? ui.grow : undefined}>
          <VideoSurface
            title={
              failed
                ? 'Nothing is playing'
                : state?.ready
                ? ''
                : 'Opening the video'
            }
            detail={
              state?.ready && !failed && !state.closed
                ? 'Use the controls below, or the keyboard in that window.'
                : ''
            }
          />
        </View>
        {wide && (
          <SideEpisode
            direction="Next"
            target={next}
            {...neighbour(next)}
            onPress={() => next && navigate(targetRoute(next))}
          />
        )}
      </View>
      {!wide && (previous || next) && (
        <View
          key={`strip-${width}`}
          style={[styles.strip, phone && styles.stripPhone]}
        >
          <StripEpisode
            direction="Previous"
            target={previous}
            {...neighbour(previous)}
            onPress={() => previous && navigate(targetRoute(previous))}
          />
          <StripEpisode
            direction="Next"
            target={next}
            {...neighbour(next)}
            onPress={() => next && navigate(targetRoute(next))}
          />
        </View>
      )}
      {failed !== '' && (
        <View style={styles.failed}>
          <Text selectable style={[ui.error, ui.grow]}>
            {failed}
          </Text>
          <Button
            label="Anime details"
            primary
            onPress={() => navigate({ name: 'details', animeId })}
          />
        </View>
      )}
      <View
        style={[
          styles.controls,
          (failed !== '' || Platform.OS === 'windows') && styles.gone,
        ]}
      >
        {state && (
          <Scrubber
            position={state.position}
            duration={state.duration}
            onSeek={position => action('seek', { position })}
          />
        )}
        <View style={styles.transport}>
          <IconButton
            icon="back"
            label="Previous"
            disabled={!previous}
            onPress={() => previous && navigate(targetRoute(previous))}
          />
          <Button
            label="-10s"
            onPress={() =>
              action('seek', {
                position: Math.max(0, (state?.position ?? 0) - 10),
              })
            }
          />
          <IconButton
            icon={state?.paused ? 'play' : 'pause'}
            label={state?.paused ? 'Play' : 'Pause'}
            size={26}
            solid
            onPress={() => action(state?.paused ? 'play' : 'pause')}
          />
          <Button
            label="+10s"
            onPress={() =>
              action('seek', {
                position: Math.min(
                  state?.duration ?? 0,
                  (state?.position ?? 0) + 10,
                ),
              })
            }
          />
          <IconButton
            icon="forward"
            label="Next"
            disabled={!next}
            onPress={() => next && navigate(targetRoute(next))}
          />
          <View style={ui.grow} />
          <IconButton
            icon={volume === 0 ? 'mute' : 'volume'}
            label={volume === 0 ? 'Unmute' : 'Mute'}
            onPress={() => {
              setVolume(v => (v === 0 ? 1 : 0));
              action('volume', { volume: volume === 0 ? 1 : 0 });
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
                    format: text.replace(/^﻿/, '').startsWith('WEBVTT')
                      ? 'vtt'
                      : 'srt',
                  });
                }
              }, 'Subtitles loaded').catch(w.setError);
            }}
          />
          {Platform.OS === 'android' && Number(Platform.Version) >= 26 && (
            <IconButton
              icon="player"
              label="Picture in picture"
              onPress={() => action('pip')}
            />
          )}
          <IconButton
            icon="fullscreen"
            label="Fullscreen"
            onPress={() => action('fullscreen')}
          />
        </View>
      </View>
      <View style={styles.options}>
        <Choice
          inline
          label="Playback speed"
          values={['0.5', '0.75', '1', '1.25', '1.5', '2']}
          value={speed}
          display={`${speed}x`}
          onChange={v => {
            setSpeed(v);
            action('rate', { rate: Number(v) });
          }}
        />
        <Choice
          inline
          label="Volume"
          values={['0', '25', '50', '75', '100']}
          value={String(Math.round(volume * 100))}
          display={`${Math.round(volume * 100)}%`}
          onChange={v => {
            setVolume(Number(v) / 100);
            action('volume', { volume: Number(v) / 100 });
          }}
        />
        <Choice
          inline
          label="Audio"
          values={state?.audio.map(t => t.label) ?? []}
          value={audioLabel}
          onChange={label => {
            setAudioLabel(label);
            action('audio', {
              id: state?.audio.find(t => t.label === label)?.id ?? '',
            });
          }}
        />
        <Choice
          inline
          label="Subtitles"
          values={['Off', ...(state?.subtitles.map(t => t.label) ?? [])]}
          value={subtitleLabel}
          onChange={label => {
            setSubtitleLabel(label);
            action('subtitle', {
              id: state?.subtitles.find(t => t.label === label)?.id ?? 'off',
            });
          }}
        />
        <Choice
          inline
          label="Jump to episode"
          values={entry.episodes.map(e => `${e.number}. ${e.title}`)}
          value={`${ep.number}. ${ep.title}`}
          display={`Episode ${ep.number}`}
          onChange={label => {
            const item = entry.episodes.find(
              e => `${e.number}. ${e.title}` === label,
            );
            if (item) {
              navigate({
                name: 'player',
                animeId,
                episodeId: item.id,
                resume: false,
              });
            }
          }}
        />
        <View style={styles.seek}>
          <Text style={ui.muted}>Seek to seconds</Text>
          <View style={styles.seekRow}>
            <TextInput
              {...noFocusRing}
              accessibilityLabel="Seek to seconds"
              placeholder="120"
              placeholderTextColor={colors.muted}
              value={seek}
              keyboardType="number-pad"
              onChangeText={setSeek}
              style={[ui.input, styles.seekInput]}
            />
            <IconButton
              icon="check"
              label="Seek"
              size={12}
              disabled={seek.trim() === ''}
              onPress={() => action('seek', { position: Number(seek) })}
            />
          </View>
        </View>
        {failed === '' && (
          <View style={styles.seek}>
            <Text style={ui.muted}>This anime</Text>
            <Pressable
              {...noFocusRing}
              accessibilityRole="link"
              accessibilityLabel="Anime details"
              onPress={() => navigate({ name: 'details', animeId })}
              style={styles.detailsLink}
            >
              <Text style={ui.text}>Anime details</Text>
              <Icon name="forward" size={12} color={colors.muted} />
            </Pressable>
          </View>
        )}
      </View>
    </PanelPage>
  );
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const rest = String(total % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
}

function Scrubber({
  position,
  duration,
  onSeek,
}: {
  position: number;
  duration: number;
  onSeek: (position: number) => void;
}): React.JSX.Element {
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const at = (x: number) =>
    trackWidth ? Math.min(1, Math.max(0, x / trackWidth)) * duration : 0;
  const shown = dragging ?? position;
  return (
    <View style={styles.timeline}>
      <Text style={styles.time}>{clock(shown)}</Text>
      <View
        style={styles.track}
        onLayout={e => setTrackWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => duration > 0}
        onMoveShouldSetResponder={() => duration > 0}
        onResponderGrant={e => setDragging(at(e.nativeEvent.locationX))}
        onResponderMove={e => setDragging(at(e.nativeEvent.locationX))}
        onResponderRelease={e => {
          setDragging(null);
          onSeek(at(e.nativeEvent.locationX));
        }}
        onResponderTerminate={() => setDragging(null)}
      >
        <View pointerEvents="none">
          <ProgressBar
            value={duration ? (shown / duration) * 100 : 0}
            label="Playback position"
          />
        </View>
      </View>
      <Text style={styles.time}>{clock(duration)}</Text>
    </View>
  );
}

function StripEpisode({
  direction,
  target,
  uri,
  label,
  onPress,
}: {
  direction: string;
  target: PlaybackTarget | null;
  uri: string | null;
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  if (!target) {
    return <View style={ui.grow} />;
  }
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="button"
      accessibilityLabel={`${direction}: ${label}`}
      onPress={onPress}
      style={styles.stripItem}
    >
      {uri && (
        <Image source={{ uri }} resizeMode="cover" style={styles.stripArt} />
      )}
      <View style={styles.stripCopy}>
        <Text style={ui.small}>{direction}</Text>
        <Text numberOfLines={2} style={styles.sideLabel}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function SideEpisode({
  direction,
  target,
  uri,
  label,
  onPress,
}: {
  direction: string;
  target: PlaybackTarget | null;
  uri: string | null;
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  if (!target) {
    return <View style={styles.side} />;
  }
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="button"
      accessibilityLabel={`${direction}: ${label}`}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={styles.side}
    >
      {uri && (
        <Image
          source={{ uri }}
          resizeMode="cover"
          style={[styles.sideArt, hover ? styles.sideLit : styles.sideDim]}
        />
      )}
      <FadeEdges x={36} y={70} />
      <View style={styles.sideCopy}>
        <Text style={ui.small}>{direction}</Text>
        <Text numberOfLines={3} style={styles.sideLabel}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: displayFamily,
    fontSize: 42,
    lineHeight: 48,
    fontWeight: '700',
    letterSpacing: -1,
    color: colors.text,
    textAlign: 'center',
  },
  titlePhone: { fontFamily, fontSize: 26, lineHeight: 32, letterSpacing: -0.4 },
  episode: { fontFamily, textAlign: 'center', marginBottom: 12 },
  stage: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  side: {
    width: 112,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  sideArt: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  sideDim: { opacity: 0.32 },
  sideLit: { opacity: 0.75 },
  sideCopy: { paddingHorizontal: 10, gap: 3 },
  stripCopy: { flexShrink: 1 },
  sideLabel: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  strip: { flexDirection: 'row', gap: 24, marginTop: 14 },
  stripPhone: { flexDirection: 'column', gap: 10 },
  stripItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  stripArt: { width: 44, height: 62, borderRadius: 4 },
  failed: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
  },
  gone: { display: 'none' },
  track: { flex: 1, height: 24, justifyContent: 'center' },
  controls: { gap: 10, marginTop: 14 },
  timeline: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  time: {
    fontFamily,
    fontSize: 13,
    color: colors.muted,
    fontVariant: ['tabular-nums'],
  },
  transport: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  options: {
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
  seek: { gap: 6 },
  seekRow: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 32 },
  seekInput: { minHeight: 32, height: 32, width: 72, paddingVertical: 0 },
  detailsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 32,
  },
});
