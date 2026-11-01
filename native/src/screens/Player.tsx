import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, ScrollView, Text, View } from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import { Button, Choice, Field, ProgressBar } from '../components/controls';
import { ui } from '../design/theme';
import { MediaResolver } from '../services/media';
import {
  CompletionGuard,
  PlaybackState,
  saveProgress,
} from '../services/progress';
import { setWatched } from '../services/mutations';
import { playerCommand } from '../platform/nativePlayer';
import VideoSurface from '../platform/VideoSurface';
import { resolveTarget, targetRoute } from '../services/playback';

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
  const [volume, setVolume] = useState(1);
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
        if (live) {
          setState(value);
        }
        if (value.error) {
          throw new Error(value.error);
        }
        if (completion.shouldAdvance(value.ended)) {
          save(value).catch(latest.current.setError);
          const catalog = latest.current.catalog;
          const next = catalog
            ? resolveTarget(catalog, animeId, episodeId, 1, queueAnchor)
            : null;
          if (live && next) {
            navigate(targetRoute(next));
          }
        } else if (
          value.ready &&
          (Date.now() - lastSaved >= 8000 ||
            (value.paused && stateChanged(value)))
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
        latest.current.setError(String(error));
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
  if (!entry || !ep) {
    return (
      <View style={ui.page}>
        <Text style={ui.heading}>Episode no longer exists</Text>
      </View>
    );
  }
  const previous = resolveTarget(
    w.catalog!,
    animeId,
    episodeId,
    -1,
    queueAnchor,
  );
  const next = resolveTarget(w.catalog!, animeId, episodeId, 1, queueAnchor);
  return (
    <ScrollView contentContainerStyle={ui.page}>
      <Text accessibilityRole="header" style={ui.heading}>
        {entry.title}
      </Text>
      <Text style={ui.subheading}>
        {entry.season} · Episode {ep.number}: {ep.title}
      </Text>
      <VideoSurface />
      <View style={ui.card}>
        <Text style={ui.text}>Playback controls</Text>
        <Text style={ui.muted}>
          Video opens in the app’s native player. Use its transport controls or
          these controls. Missing codecs are reported by the native backend.
        </Text>
        <Button
          label={state?.closed ? 'Reopen player' : 'Focus video'}
          primary
          onPress={() => action('show')}
        />
        {state && (
          <>
            <Text style={ui.text}>
              {Math.floor(state.position)} / {Math.floor(state.duration)}{' '}
              seconds
            </Text>
            <ProgressBar
              value={
                state.duration ? (state.position / state.duration) * 100 : 0
              }
              label="Playback position"
            />
          </>
        )}
        <View style={ui.row}>
          <Button
            label="Back 10 seconds"
            onPress={() =>
              action('seek', {
                position: Math.max(0, (state?.position ?? 0) - 10),
              })
            }
          />
          <Button
            label={state?.paused ? 'Play' : 'Pause'}
            onPress={() => action(state?.paused ? 'play' : 'pause')}
          />
          <Button
            label="Forward 10 seconds"
            onPress={() =>
              action('seek', {
                position: Math.min(
                  state?.duration ?? 0,
                  (state?.position ?? 0) + 10,
                ),
              })
            }
          />
          <Button label="Fullscreen" onPress={() => action('fullscreen')} />
          {Platform.OS === 'android' && Number(Platform.Version) >= 26 && (
            <Button label="Picture in picture" onPress={() => action('pip')} />
          )}
          <Button
            label={volume === 0 ? 'Unmute' : 'Mute'}
            onPress={() => {
              setVolume(v => (v === 0 ? 1 : 0));
              action('volume', { volume: volume === 0 ? 1 : 0 });
            }}
          />
        </View>
        <Field
          label="Seek to seconds"
          value={seek}
          numeric
          onChange={setSeek}
        />
        <Button
          label="Seek"
          onPress={() => action('seek', { position: Number(seek) })}
        />
        <Choice
          label="Playback speed"
          values={['0.5', '0.75', '1', '1.25', '1.5', '2']}
          value={speed}
          onChange={v => {
            setSpeed(v);
            action('rate', { rate: Number(v) });
          }}
        />
        <Choice
          label="Volume"
          values={['0', '25', '50', '75', '100']}
          value={String(Math.round(volume * 100))}
          onChange={v => {
            setVolume(Number(v) / 100);
            action('volume', { volume: Number(v) / 100 });
          }}
        />
        <Choice
          label="Audio"
          values={state?.audio.map(t => t.label) ?? []}
          value="Select audio track"
          onChange={label =>
            action('audio', {
              id: state?.audio.find(t => t.label === label)?.id ?? '',
            })
          }
        />
        <Choice
          label="Subtitles"
          values={['Off', ...(state?.subtitles.map(t => t.label) ?? [])]}
          value="Select subtitles"
          onChange={label =>
            action('subtitle', {
              id: state?.subtitles.find(t => t.label === label)?.id ?? 'off',
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
                  format: text.replace(/^\uFEFF/, '').startsWith('WEBVTT')
                    ? 'vtt'
                    : 'srt',
                });
              }
            }, 'Subtitles loaded').catch(w.setError);
          }}
        />
      </View>
      <View style={ui.row}>
        <Button
          label="Previous"
          disabled={!previous}
          onPress={() => {
            if (previous) {
              navigate(targetRoute(previous));
            }
          }}
        />
        <Button
          label="Next"
          disabled={!next}
          onPress={() => {
            if (next) {
              navigate(targetRoute(next));
            }
          }}
        />
        <Button
          label="Anime details"
          onPress={() => navigate({ name: 'details', animeId })}
        />
      </View>
      <Choice
        label="Jump to episode"
        values={entry.episodes.map(e => `${e.number}. ${e.title}`)}
        value={`${ep.number}. ${ep.title}`}
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
    </ScrollView>
  );
}
