import React, { useEffect, useRef, useState } from 'react';
import {
  AppState,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import { Button } from '../components/controls';
import { Icon, IconButton } from '../components/Icon';
import { coverUri } from '../components/Cover';
import { OuterFade, PanelPage } from '../components/Fade';
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
import { Catalog, Episode } from '../domain/catalog';
import { setWatched } from '../services/mutations';
import { playerCommand } from '../platform/nativePlayer';
import VideoSurface from '../platform/VideoSurface';
import {
  PlaybackTarget,
  resolveTarget,
  targetRoute,
} from '../services/playback';

// Page keys mapped to mpv's key names; mpv's own bindings then apply.
const PLAYER_KEYS: Record<string, string> = {
  ' ': 'SPACE',
  Space: 'SPACE',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  f: 'f',
  F: 'f',
  m: 'm',
  M: 'm',
  n: 'n',
  p: 'p',
  Escape: 'ESC',
  MediaPlayPause: 'PLAYPAUSE',
  MediaTrackNext: 'NEXT',
  MediaTrackPrevious: 'PREV',
};

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
        setFailed(
          String((error as { message?: string })?.message ?? error).replace(
            /^Error: /,
            '',
          ),
        );
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
      <View
        // Player keys keep working after a click on a page control moves focus off
        // the video. Typing in a text field is left alone.
        {...{
          onKeyDown: (e: { nativeEvent: { key: string } }) => {
            const key = PLAYER_KEYS[e.nativeEvent.key];
            if (key && !TextInput.State.currentlyFocusedInput()) {
              playerCommand('key', { key }).catch(() => undefined);
            }
          },
        }}
      >
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
              detail=""
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
        {entry.episodes.length > 1 && (
          <View style={[styles.episodes, wide && styles.episodesWide]}>
            <EpisodeRail
              episodes={entry.episodes}
              currentId={episodeId}
              progress={w.catalog!.progress}
              onPick={id =>
                navigate({
                  name: 'player',
                  animeId,
                  episodeId: id,
                  resume: true,
                })
              }
            />
          </View>
        )}
      </View>
    </PanelPage>
  );
}

/**
 * Every episode in a sideways-scrolling rail under the video. The playing one is
 * blue and starts centred, watched ones are green, part-watched ones show progress.
 */
function EpisodeRail({
  episodes,
  currentId,
  progress,
  onPick,
}: {
  episodes: Episode[];
  currentId: string;
  progress: Catalog['progress'];
  onPick: (id: string) => void;
}): React.JSX.Element {
  const rail = useRef<ScrollView>(null);
  const [view, setView] = useState(0);
  const offset = useRef(0);
  const index = Math.max(
    0,
    episodes.findIndex(e => e.id === currentId),
  );
  const step = CARD + GAP;
  const scrollBy = (pages: number) =>
    rail.current?.scrollTo({
      x: Math.max(0, offset.current + pages * Math.max(step, view - step)),
      animated: true,
    });
  return (
    <View style={styles.railBlock}>
      <View style={styles.railHead}>
        <Text style={styles.overline}>Episodes</Text>
        <Text style={styles.railCount}>
          {index + 1} of {episodes.length}
        </Text>
        <View style={ui.grow} />
        <IconButton
          icon="back"
          label="Earlier episodes"
          size={16}
          onPress={() => scrollBy(-1)}
        />
        <IconButton
          icon="forward"
          label="Later episodes"
          size={16}
          onPress={() => scrollBy(1)}
        />
      </View>
      {/* The scrollbar sits in a strip the wrapper clips off; arrows and the wheel scroll instead. */}
      <View style={styles.railClip}>
        <ScrollView
          ref={rail}
          horizontal
          style={styles.railScroll}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.railRow}
          scrollEventThrottle={32}
          onScroll={e => {
            offset.current = e.nativeEvent.contentOffset.x;
          }}
          onLayout={e => {
            const width = e.nativeEvent.layout.width;
            setView(width);
            // Opens with the playing episode centred.
            rail.current?.scrollTo({
              x: Math.max(0, index * step - (width - CARD) / 2),
              animated: false,
            });
          }}
        >
          {episodes.map(e => {
            const saved = progress[e.id];
            const percent =
              saved && saved.duration
                ? (saved.currentTime / saved.duration) * 100
                : 0;
            return (
              <EpisodeCard
                key={e.id}
                number={e.number}
                title={
                  e.title !== '' && e.title !== `Episode ${e.number}`
                    ? e.title
                    : ''
                }
                current={e.id === currentId}
                watched={e.watched}
                percent={percent}
                onPress={() => e.id !== currentId && onPick(e.id)}
              />
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

// Width of the previous/next covers beside the video.
const SIDE = 150;
const CARD = 148;
const GAP = 10;

function EpisodeCard({
  number,
  title,
  current,
  watched,
  percent,
  onPress,
}: {
  number: number;
  title: string;
  current: boolean;
  watched: boolean;
  percent: number;
  onPress: () => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const started = !watched && percent > 1 && percent < 90;
  const status = current
    ? 'Playing'
    : watched
    ? 'Watched'
    : started
    ? `${Math.round(percent)}% watched`
    : 'Not watched';
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="button"
      accessibilityLabel={`Episode ${number}${
        title ? `: ${title}` : ''
      }, ${status}`}
      accessibilityState={{ selected: current }}
      {...{ tooltip: title || `Episode ${number}` }}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={[
        styles.card,
        watched && styles.cardWatched,
        // Hover keeps each card's colour: green stays green, blue for the rest.
        hover &&
          !current &&
          (watched ? styles.cardWatchedHover : styles.cardHover),
        current && styles.cardCurrent,
      ]}
    >
      <View style={styles.cardTop}>
        <Text
          style={[
            styles.cardNumber,
            watched && styles.cardNumberWatched,
            current && styles.cardNumberCurrent,
          ]}
        >
          {number}
        </Text>
        {current ? (
          <Icon name="play" size={14} color={colors.accent} />
        ) : watched ? (
          <Icon name="check" size={14} color={colors.success} />
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        style={[styles.cardLabel, (hover || current) && styles.cardLabelLit]}
      >
        {title || status}
      </Text>
      <View style={styles.cardTrack}>
        <View
          style={[
            styles.cardFill,
            watched && styles.cardFillWatched,
            {
              width: `${
                watched ? 100 : current || started ? Math.max(4, percent) : 0
              }%`,
            },
          ]}
        />
      </View>
    </Pressable>
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
  const [hover, setHover] = useState(false);
  if (!target) {
    return <View style={ui.grow} />;
  }
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="button"
      accessibilityLabel={`${direction}: ${label}`}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={[styles.stripItem, hover && styles.stripHover]}
    >
      {uri && (
        <Image source={{ uri }} resizeMode="cover" style={styles.stripArt} />
      )}
      <View style={styles.stripCopy}>
        <Text style={[styles.overline, hover && styles.overlineLit]}>
          {direction}
        </Text>
        <Text numberOfLines={2} style={styles.sideLabel}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * The previous or next title beside the video. The art stays whole where it meets
 * the video and melts into the panel on its outer side.
 */
function SideEpisode({
  direction,
  target,
  uri,
  label,
  onPress,
}: {
  direction: 'Previous' | 'Next';
  target: PlaybackTarget | null;
  uri: string | null;
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  if (!target) {
    return <View style={styles.side} />;
  }
  const left = direction === 'Previous';
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
          style={[styles.sideArt, !hover && styles.sideRest]}
        />
      )}
      <OuterFade side={left ? 'left' : 'right'} />
      <View
        style={[
          styles.sideEdge,
          left ? styles.edgeLeft : styles.edgeRight,
          hover && styles.sideEdgeLit,
        ]}
      />
      <View
        style={[styles.sideCopy, left ? styles.copyLeft : styles.copyRight]}
      >
        <Text
          style={[
            styles.overline,
            hover && styles.overlineLit,
            !left && styles.alignRight,
          ]}
        >
          {direction}
        </Text>
        <Text
          numberOfLines={3}
          style={[styles.sideLabel, !left && styles.alignRight]}
        >
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
  // The covers touch the video, so their inner edge reads as part of it.
  stage: { flexDirection: 'row', alignItems: 'stretch' },
  side: { width: SIDE, overflow: 'hidden', justifyContent: 'flex-end' },
  sideArt: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  sideRest: { opacity: 0.85 },
  sideEdge: { position: 'absolute', top: 0, bottom: 0, width: 3 },
  edgeLeft: { right: 0 },
  edgeRight: { left: 0 },
  sideEdgeLit: { backgroundColor: colors.accent },
  sideCopy: { paddingVertical: 14, gap: 3 },
  copyLeft: { paddingLeft: 4, paddingRight: 16 },
  copyRight: { paddingRight: 4, paddingLeft: 16 },
  alignRight: { textAlign: 'right' },
  overline: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  overlineLit: { color: colors.accent },
  stripCopy: { flexShrink: 1, gap: 2 },
  sideLabel: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
    color: colors.mist,
  },
  strip: { flexDirection: 'row', gap: 12, marginTop: 14 },
  stripPhone: { flexDirection: 'column', gap: 8 },
  stripItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  stripHover: { backgroundColor: colors.hover, borderColor: colors.accent },
  stripArt: { width: 44, height: 62, borderRadius: 4 },
  failed: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
  },
  episodes: { marginTop: 18 },
  // Lines up with the video's edges, between the side covers.
  episodesWide: { marginHorizontal: SIDE },
  railBlock: { gap: 10 },
  railHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 36,
  },
  railCount: { fontFamily, fontSize: 13, color: colors.muted },
  railRow: { gap: GAP, paddingTop: 2, paddingBottom: 18 },
  railClip: { overflow: 'hidden' },
  railScroll: { marginBottom: -16 },
  card: {
    width: CARD,
    gap: 6,
    paddingTop: 10,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.raised,
  },
  cardWatched: { borderColor: colors.successLine, backgroundColor: '#14261D' },
  cardHover: { borderColor: colors.accent, backgroundColor: colors.hover },
  cardWatchedHover: { borderColor: colors.success, backgroundColor: '#1D3A2A' },
  cardCurrent: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardNumber: {
    fontFamily: displayFamily,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  cardNumberWatched: { color: colors.success },
  cardNumberCurrent: { color: colors.accent },
  cardLabel: { fontFamily, fontSize: 13, color: colors.muted },
  cardLabelLit: { color: colors.mist },
  cardTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.line,
    overflow: 'hidden',
    marginTop: 2,
  },
  cardFill: { height: 3, backgroundColor: colors.accent },
  cardFillWatched: { backgroundColor: colors.success },
});
