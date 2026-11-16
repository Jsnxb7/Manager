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
import { clearProgress } from '../services/mutations';
import { playerCommand } from '../platform/nativePlayer';
import VideoSurface from '../platform/VideoSurface';
import { usePreview } from '../platform/usePreview';
import {
  PlaybackTarget,
  resolveTarget,
  targetRoute,
} from '../services/playback';

// Page keys mapped to mpv's key names; mpv's own bindings then apply.
// Space is left out: on a focused page button it presses that button, and the
// video takes focus back right after (refocusVideo), where Space pauses.
const PLAYER_KEYS: Record<string, string> = {
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
  // Speed down/up/reset, then subtitle and audio track cycling.
  '[': '[',
  ']': ']',
  Backspace: 'BS',
  j: 'j',
  J: 'J',
  '#': '#',
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
  // After the last second, the next episode starts on its own unless cancelled.
  const [upNext, setUpNext] = useState<{
    target: PlaybackTarget;
    left: number;
  } | null>(null);
  const upNextRef = useRef<{ target: PlaybackTarget; deadline: number } | null>(
    null,
  );
  // The card over the video goes when the countdown ends, is cancelled, or the page closes.
  const counting = upNext !== null;
  useEffect(() => {
    if (Platform.OS !== 'windows') {
      return;
    }
    const clear = () => {
      playerCommand('overlay', { ass: '' }).catch(() => undefined);
    };
    if (!counting) {
      clear();
    }
    return counting ? clear : undefined;
  }, [counting]);
  const cancelUpNext = () => {
    upNextRef.current = null;
    setUpNext(null);
    playerCommand('message', { text: 'Up next cancelled' }).catch(
      () => undefined,
    );
  };
  useEffect(() => {
    if (!entry || !ep) {
      return;
    }
    let live = true,
      polling = false,
      lastSaved = Date.now();
    let completion = new CompletionGuard();
    upNextRef.current = null;
    setUpNext(null);
    // The audio and subtitles playing when the video opened; a later change is
    // the viewer's choice and is remembered for this title.
    const tracksAtOpen: { audio?: string; subtitle?: string } = {};
    const rememberTracks = (value: PlaybackState) => {
      const changes: { audio?: string; subtitle?: string } = {};
      for (const [kind, now] of [
        ['audio', value.audioTrack],
        ['subtitle', value.subtitleTrack],
      ] as const) {
        if (!now) {
          continue;
        }
        if (tracksAtOpen[kind] === undefined) {
          tracksAtOpen[kind] = now;
        } else if (tracksAtOpen[kind] !== now) {
          tracksAtOpen[kind] = now;
          changes[kind] = now;
        }
      }
      if (changes.audio || changes.subtitle) {
        latest.current
          .updateSettings(s => {
            s.tracks[animeId] = { ...s.tracks[animeId], ...changes };
          })
          .catch(latest.current.setError);
      }
    };
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
        if (value.ready) {
          rememberTracks(value);
        }
        if (!value.ended) {
          // Seeking back or replaying cancels a countdown and re-arms the end.
          completion = new CompletionGuard();
          if (upNextRef.current) {
            upNextRef.current = null;
            setUpNext(null);
          }
        }
        const pending = upNextRef.current;
        if (pending && live) {
          const left = Math.max(
            0,
            Math.ceil((pending.deadline - Date.now()) / 1000),
          );
          if (left <= 0) {
            upNextRef.current = null;
            navigate(targetRoute(pending.target));
            return;
          }
          setUpNext({ target: pending.target, left });
          playerCommand('overlay', {
            ass: upNextCard(
              upNextLabel(latest.current.catalog, pending.target, animeId),
              left,
            ),
          }).catch(() => undefined);
        }
        if (completion.shouldAdvance(value.ended)) {
          await save(value).catch(latest.current.setError);
          const catalog = latest.current.catalog;
          const next = catalog
            ? resolveTarget(catalog, animeId, episodeId, 1, queueAnchor)
            : null;
          if (live && next) {
            upNextRef.current = {
              target: next,
              deadline: Date.now() + UP_NEXT_SECONDS * 1000,
            };
            setUpNext({ target: next, left: UP_NEXT_SECONDS });
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
      // Starting from the beginning only drops the saved position, as the old app
      // did. Watched marks stay: Previous or auto-next onto a watched episode must
      // not undo it.
      if (!resume && latest.current.catalog?.progress[episodeId]) {
        await latest.current.mutate(c => clearProgress(c, episodeId));
      }
      const position = resume
        ? latest.current.catalog?.progress[episodeId]?.currentTime ?? 0
        : 0;
      const tracks = latest.current.settings.tracks[animeId];
      await playerCommand('open', {
        uri: file.uri,
        position,
        audio: tracks?.audio ?? '',
        subtitle: tracks?.subtitle ?? '',
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
    <PanelPage flush pinTop>
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
        <View key={`head-${width}`} style={styles.head}>
          <View style={styles.headMeta}>
            <Text style={[styles.overline, styles.overlineLit]}>
              {[
                entry.season,
                `Episode ${ep.number} of ${entry.episodes.length}`,
              ]
                .filter(Boolean)
                .join('  ·  ')}
            </Text>
            {ep.title !== `Episode ${ep.number}` && ep.title ? (
              <Text numberOfLines={1} style={styles.headEpisode}>
                {ep.title}
              </Text>
            ) : null}
          </View>
          <TitleLink
            title={entry.title}
            phone={phone}
            onPress={() => navigate({ name: 'details', animeId })}
          />
        </View>
        <View style={wide ? styles.stage : undefined}>
          {wide && (
            <SideEpisode
              workspace={w}
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
              workspace={w}
              direction="Next"
              target={next}
              {...neighbour(next)}
              onPress={() => next && navigate(targetRoute(next))}
            />
          )}
        </View>
        {state?.ready && (
          <View style={[styles.tools, wide && styles.toolsWide]}>
            {canPip && (
              <IconButton
                icon="pip"
                label="Picture in picture"
                size={18}
                onPress={() => {
                  playerCommand('pip').then(refocusVideo).catch(w.setError);
                }}
              />
            )}
            <IconButton
              icon="fullscreen"
              label="Fullscreen"
              size={18}
              onPress={() => {
                playerCommand('fullscreen').catch(w.setError);
              }}
            />
          </View>
        )}
        {upNext && (
          <UpNext
            key={`next-${width}`}
            left={upNext.left}
            label={upNextLabel(w.catalog, upNext.target, animeId)}
            uri={neighbour(upNext.target).uri}
            wide={wide}
            phone={phone}
            onPlay={() => {
              upNextRef.current = null;
              navigate(targetRoute(upNext.target));
            }}
            onCancel={cancelUpNext}
          />
        )}
        {!wide && (previous || next) && (
          <View
            key={`strip-${width}`}
            style={[styles.strip, phone && styles.stripPhone]}
          >
            <StripEpisode
              workspace={w}
              direction="Previous"
              target={previous}
              {...neighbour(previous)}
              onPress={() => previous && navigate(targetRoute(previous))}
            />
            <StripEpisode
              workspace={w}
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
const UP_NEXT_SECONDS = 4;

/** ASS colour from #RRGGBB (ASS orders it blue, green, red). */
function assColor(hex: string): string {
  const h = hex.replace('#', '');
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`;
}

/** A rounded rectangle in ASS drawing commands. */
function assBox(w: number, h: number, r: number): string {
  return `m ${r} 0 l ${w - r} 0 b ${w} 0 ${w} 0 ${w} ${r} l ${w} ${
    h - r
  } b ${w} ${h} ${w} ${h} ${w - r} ${h} l ${r} ${h} b 0 ${h} 0 ${h} 0 ${
    h - r
  } l 0 ${r} b 0 0 0 0 ${r} 0`;
}

/**
 * The up-next card mpv draws over the video on PC, matching the page's panel:
 * night-blue box, blue overline, the next title, and a draining countdown bar.
 */
function upNextCard(label: string, left: number): string {
  const x = 28;
  const y = 28;
  const w = 430;
  const h = 104;
  const pad = 22;
  const track = w - pad * 2;
  const fill = Math.max(4, Math.round((track * left) / UP_NEXT_SECONDS));
  const safe = label.replace(/[{}\\]/g, '').slice(0, 46);
  const base = '\\bord0\\shad0\\blur0';
  return [
    `{\\an7\\pos(${x},${y})${base}\\1c${assColor(
      '#0A131D',
    )}\\1a&H28&\\p1}${assBox(w, h, 14)}{\\p0}`,
    `{\\an7\\pos(${x},${y})${base}\\1c${assColor(
      '#2A3A4B',
    )}\\1a&H00&\\3a&HFF&\\p1}${assBox(4, h, 2)}{\\p0}`,
    `{\\an7\\pos(${x + pad},${
      y + 16
    })${base}\\fnBahnschrift\\fs15\\fsp1.5\\1c${assColor(
      '#86B8DC',
    )}}UP NEXT IN ${left} S`,
    `{\\an7\\pos(${x + pad},${
      y + 38
    })${base}\\fnBahnschrift SemiBold\\fs24\\1c${assColor('#F1F3F5')}}${safe}`,
    `{\\an7\\pos(${x + pad},${y + h - 22})${base}\\1c${assColor(
      '#1D2B3A',
    )}\\p1}${assBox(track, 4, 2)}{\\p0}`,
    `{\\an7\\pos(${x + pad},${y + h - 22})${base}\\1c${assColor(
      '#86B8DC',
    )}\\p1}${assBox(fill, 4, 2)}{\\p0}`,
  ].join('\n');
}

/** "Episode 5", or the title name when the queue moves to another title. */
function upNextLabel(
  catalog: Catalog | null,
  target: PlaybackTarget,
  animeId: string,
): string {
  const item = catalog?.entries.find(e => e.id === target.entryId);
  const number = item?.episodes.find(e => e.id === target.episodeId)?.number;
  if (!item) {
    return 'Next episode';
  }
  return item.id === animeId
    ? `Episode ${number ?? ''}`
    : `${item.title}, episode ${number ?? ''}`;
}

/**
 * The countdown under the video once an episode ends. The video is a native
 * surface the page cannot draw over, so on PC mpv repeats the count on screen.
 */
function UpNext({
  left,
  label,
  uri,
  wide,
  phone,
  onPlay,
  onCancel,
}: {
  left: number;
  label: string;
  uri: string | null;
  wide: boolean;
  phone: boolean;
  onPlay: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.upNext,
        wide && styles.toolsWide,
        phone && styles.upNextPhone,
      ]}
    >
      {uri ? <Image source={{ uri }} style={styles.stripArt} /> : null}
      <View style={styles.upNextCopy}>
        <Text style={[styles.overline, styles.overlineLit]}>
          Up next in {left} s
        </Text>
        <Text numberOfLines={1} style={[styles.sideLabel, styles.upNextLabel]}>
          {label}
        </Text>
        <View style={styles.upNextTrack}>
          <View
            style={[
              styles.upNextFill,
              { width: `${(left / UP_NEXT_SECONDS) * 100}%` },
            ]}
          />
        </View>
      </View>
      <View style={styles.upNextActions}>
        <Button label="Play now" primary onPress={onPlay} />
        <Button label="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

/**
 * The anime title, which opens its details. The chevron marks it as a link at
 * all times (phones have no hover); hovering tints both and nudges the chevron.
 */
function TitleLink({
  title,
  phone,
  onPress,
}: {
  title: string;
  phone: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="link"
      accessibilityLabel={title}
      accessibilityHint="Opens the anime details"
      {...{ tooltip: 'Anime details' }}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={({ pressed }) => [
        styles.titleLink,
        pressed && styles.titlePressed,
      ]}
    >
      <Text
        numberOfLines={2}
        style={[
          styles.title,
          phone && styles.titlePhone,
          styles.titleText,
          hover && styles.titleHover,
        ]}
      >
        {title}
      </Text>
      <View style={[styles.titleChevron, hover && styles.titleChevronHover]}>
        <Icon
          name="forward"
          size={phone ? 14 : 16}
          color={hover ? colors.background : colors.chrome}
        />
      </View>
    </Pressable>
  );
}

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
  const scrollBy = (pages: number) => {
    rail.current?.scrollTo({
      x: Math.max(0, offset.current + pages * Math.max(step, view - step)),
      animated: true,
    });
    refocusVideo();
  };
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

// Keyboard focus goes back to the video after a page button, so Space and the
// arrows keep controlling playback instead of pressing that button again.
const refocusVideo = (): void => {
  if (Platform.OS === 'windows') {
    playerCommand('show').catch(() => undefined);
  }
};

// Windows floats the video in its own window; Android supports it from API 26.
const canPip =
  Platform.OS === 'windows' ||
  (Platform.OS === 'android' && Number(Platform.Version) >= 26);

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
  workspace,
}: {
  workspace: Workspace;
  direction: string;
  target: PlaybackTarget | null;
  uri: string | null;
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const clip = usePreview(
    workspace,
    target
      ? {
          entryId: target.entryId,
          episodeId: target.episodeId,
          start: target.resume
            ? workspace.catalog?.progress[target.episodeId]?.currentTime ?? 0
            : 0,
        }
      : null,
  );
  if (!target) {
    return <View style={ui.grow} />;
  }
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="button"
      accessibilityLabel={`${direction}: ${label}`}
      onPress={onPress}
      ref={clip.ref}
      onHoverIn={() => {
        setHover(true);
        clip.onHoverIn();
      }}
      onHoverOut={() => {
        setHover(false);
        clip.onHoverOut();
      }}
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
  workspace,
}: {
  workspace: Workspace;
  direction: 'Previous' | 'Next';
  target: PlaybackTarget | null;
  uri: string | null;
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const clip = usePreview(
    workspace,
    target
      ? {
          entryId: target.entryId,
          episodeId: target.episodeId,
          start: target.resume
            ? workspace.catalog?.progress[target.episodeId]?.currentTime ?? 0
            : 0,
        }
      : null,
  );
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
      ref={clip.ref}
      onHoverIn={() => {
        setHover(true);
        clip.onHoverIn();
      }}
      onHoverOut={() => {
        setHover(false);
        clip.onHoverOut();
      }}
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
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    letterSpacing: -0.6,
    color: colors.mist,
    textAlign: 'center',
  },
  titlePhone: { fontFamily, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  head: { alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 18 },
  headMeta: { alignItems: 'center', gap: 2 },
  headEpisode: { fontFamily, fontSize: 14, color: colors.muted },
  titleLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    maxWidth: '100%',
    gap: 12,
  },
  titlePressed: { opacity: 0.7 },
  titleText: { flexShrink: 1 },
  titleHover: { color: colors.accent },
  titleChevron: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.raised,
  },
  titleChevronHover: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    transform: [{ translateX: 3 }],
  },
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
  upNext: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 16,
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#0E1A26',
  },
  upNextPhone: { padding: 10, gap: 10 },
  upNextCopy: { flexGrow: 1, flexBasis: 200, flexShrink: 1, gap: 4 },
  upNextTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.raised,
    overflow: 'hidden',
    marginTop: 8,
  },
  upNextFill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  upNextActions: { flexDirection: 'row', gap: 8 },
  upNextLabel: { fontSize: 18 },
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
  tools: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 6,
  },
  // Lines up with the video's right edge, inside the side covers.
  toolsWide: { marginHorizontal: SIDE },
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
