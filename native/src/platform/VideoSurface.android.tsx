import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Video, {
  SelectedTrack,
  SelectedTrackType,
  VideoRef,
  TextTracks,
  TextTrackType,
} from 'react-native-video';
import { registerPlayerDriver } from './nativePlayer';
import { PlaybackState } from '../services/progress';
import { useViewport } from '../design/viewport';
type Track = { index: number; language?: string; selected?: boolean };
/** The title's remembered track (lang:<code>, id:<n> or off) as a selection. */
function remembered(value: unknown): SelectedTrack {
  const text = typeof value === 'string' ? value : '';
  if (text === 'off') {
    return { type: SelectedTrackType.DISABLED };
  }
  if (text.startsWith('lang:') && text.length > 5) {
    return { type: SelectedTrackType.LANGUAGE, value: text.slice(5) };
  }
  if (text.startsWith('id:') && text.length > 3) {
    return { type: SelectedTrackType.INDEX, value: Number(text.slice(3)) };
  }
  return { type: SelectedTrackType.SYSTEM };
}
/** The playing track in the form the app remembers per title. */
function playing(tracks: Track[], subtitles: boolean): string {
  const track = tracks.find(t => t.selected);
  if (!track) {
    return subtitles && tracks.length ? 'off' : '';
  }
  return track.language ? `lang:${track.language}` : `id:${track.index}`;
}
export default function VideoSurface(): React.JSX.Element {
  const { height } = useViewport();
  const ref = useRef<VideoRef>(null);
  const state = useRef<PlaybackState>({
    position: 0,
    duration: 0,
    paused: true,
    ended: false,
    ready: false,
    closed: false,
    error: '',
    audio: [],
    subtitles: [],
  });
  const [uri, setUri] = useState('');
  const start = useRef(0);
  const [paused, setPaused] = useState(true);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [audio, setAudio] = useState<SelectedTrack>({
    type: SelectedTrackType.SYSTEM,
  });
  const [subtitle, setSubtitle] = useState<SelectedTrack>({
    type: SelectedTrackType.SYSTEM,
  });
  const [external, setExternal] = useState<TextTracks>([]);
  // Turning a phone sideways opens fullscreen; turning it back upright closes it.
  const screen = useWindowDimensions();
  const landscape = screen.width > screen.height;
  const phoneSized = Math.min(screen.width, screen.height) < 600;
  const fullscreen = useRef(false);
  const wasLandscape = useRef(landscape);
  useEffect(() => {
    const turned = landscape !== wasLandscape.current;
    wasLandscape.current = landscape;
    if (!turned || !phoneSized || !ref.current) {
      return;
    }
    if (landscape && !fullscreen.current && state.current.ready) {
      ref.current.presentFullscreenPlayer();
    } else if (!landscape && fullscreen.current) {
      ref.current.dismissFullscreenPlayer();
    }
  }, [landscape, phoneSized]);
  useEffect(
    () =>
      registerPlayerDriver(async (method, args) => {
        switch (method) {
          case 'open':
            state.current = {
              position: 0,
              duration: 0,
              paused: false,
              ended: false,
              ready: false,
              closed: false,
              error: '',
              audio: [],
              subtitles: [],
            };
            start.current = Number(args.position) || 0;
            setUri(String(args.uri));
            setExternal([]);
            setAudio(remembered(args.audio));
            setSubtitle(remembered(args.subtitle));
            setPaused(false);
            break;
          case 'state':
            break;
          case 'play':
            setPaused(false);
            break;
          case 'pause':
            setPaused(true);
            break;
          case 'seek': {
            const value = Math.max(
              0,
              Math.min(state.current.duration, Number(args.position) || 0),
            );
            ref.current?.seek(value);
            state.current.position = value;
            break;
          }
          case 'rate':
            setRate(Number(args.rate));
            break;
          case 'volume':
            setVolume(Number(args.volume));
            break;
          case 'audio':
            setAudio({ type: SelectedTrackType.INDEX, value: Number(args.id) });
            break;
          case 'subtitle':
            setSubtitle(
              args.id === 'off'
                ? { type: SelectedTrackType.DISABLED }
                : { type: SelectedTrackType.INDEX, value: Number(args.id) },
            );
            break;
          case 'importSubtitle':
            setExternal([
              {
                title: 'Imported subtitles',
                language: 'en',
                type:
                  args.format === 'vtt'
                    ? TextTrackType.VTT
                    : TextTrackType.SUBRIP,
                uri: String(args.uri),
              },
            ]);
            setSubtitle({
              type: SelectedTrackType.TITLE,
              value: 'Imported subtitles',
            });
            break;
          case 'pip':
            ref.current?.enterPictureInPicture();
            break;
          case 'fullscreen':
            ref.current?.presentFullscreenPlayer();
            break;
          case 'show':
            ref.current?.presentFullscreenPlayer();
            break;
          case 'close':
            setPaused(true);
            setUri('');
            break;
          default:
            throw new Error(`Unsupported player command ${method}`);
        }
        return { ...state.current };
      }),
    [],
  );
  useEffect(() => {
    state.current.paused = paused;
  }, [paused]);
  return (
    // Short screens (landscape phones) keep the episode rail reachable below.
    <View style={[styles.frame, { maxHeight: Math.max(200, height - 220) }]}>
      {uri !== '' && (
        <Video
          ref={ref}
          source={{ uri: uri.startsWith('/') ? `file://${uri}` : uri }}
          style={styles.video}
          controls
          controlsStyles={controlsStyles}
          resizeMode="contain"
          fullscreenOrientation="landscape"
          fullscreenAutorotate
          subtitleStyle={subtitleStyle}
          paused={paused}
          rate={rate}
          volume={volume}
          selectedAudioTrack={audio}
          selectedTextTrack={subtitle}
          textTracks={external}
          progressUpdateInterval={1000}
          playInBackground={false}
          onFullscreenPlayerDidPresent={() => {
            fullscreen.current = true;
          }}
          onFullscreenPlayerDidDismiss={() => {
            fullscreen.current = false;
          }}
          onLoad={event => {
            state.current.duration = event.duration;
            state.current.ready = true;
            state.current.audio = event.audioTracks.map(track => ({
              id: String(track.index),
              label:
                track.title ?? track.language ?? `Audio ${track.index + 1}`,
            }));
            state.current.subtitles = event.textTracks.map(track => ({
              id: String(track.index),
              label:
                track.title ?? track.language ?? `Subtitles ${track.index + 1}`,
            }));
            if (start.current > 1 && start.current < event.duration - 1) {
              ref.current?.seek(start.current);
              start.current = 0;
            }
          }}
          onProgress={event => {
            state.current.position = event.currentTime;
            // Seeking back from the end cancels the up-next countdown.
            if (
              state.current.ended &&
              event.currentTime < state.current.duration - 2
            ) {
              state.current.ended = false;
            }
          }}
          onEnd={() => {
            state.current.ended = true;
            state.current.paused = true;
            setPaused(true);
            // The up-next countdown shows on the page, below fullscreen.
            if (fullscreen.current) {
              ref.current?.dismissFullscreenPlayer();
            }
          }}
          onPlaybackStateChanged={event => {
            state.current.paused = !event.isPlaying;
            if (event.isPlaying) {
              state.current.ended = false;
            }
          }}
          onAudioTracks={event => {
            state.current.audioTrack = playing(event.audioTracks, false);
            state.current.audio = event.audioTracks.map(track => ({
              id: String(track.index),
              label:
                track.title ?? track.language ?? `Audio ${track.index + 1}`,
            }));
          }}
          onTextTracks={event => {
            state.current.subtitleTrack = playing(event.textTracks, true);
            state.current.subtitles = event.textTracks.map(track => ({
              id: String(track.index),
              label:
                track.title ?? track.language ?? `Subtitles ${track.index + 1}`,
            }));
          }}
          onError={event => {
            state.current.error =
              event.error.errorString ?? 'Unsupported video or codec';
          }}
        />
      )}
    </View>
  );
}
// Media3's own controller: seek bar, +/-10 s, and a settings menu for speed, audio
// and subtitle tracks. Previous and next live on the page.
const controlsStyles = {
  hideNext: true,
  hidePrevious: true,
  hideSettingButton: false,
  seekIncrementMS: 10000,
  hideNavigationBarOnFullScreenMode: true,
  hideNotificationBarOnFullScreenMode: true,
};
const subtitleStyle = { fontSize: 18, paddingBottom: 12, opacity: 1 };
const styles = StyleSheet.create({
  frame: {
    aspectRatio: 16 / 9,
    backgroundColor: '#000000',
    borderRadius: 8,
    overflow: 'hidden',
  },
  video: { flex: 1 },
});
