import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Video, {
  SelectedTrack,
  SelectedTrackType,
  VideoRef,
  TextTracks,
  TextTrackType,
} from 'react-native-video';
import { registerPlayerDriver } from './nativePlayer';
import { PlaybackState } from '../services/progress';
export default function VideoSurface(): React.JSX.Element {
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
    <View style={styles.frame}>
      {uri !== '' && (
        <Video
          ref={ref}
          source={{ uri: uri.startsWith('/') ? `file://${uri}` : uri }}
          style={styles.video}
          controls
          paused={paused}
          rate={rate}
          volume={volume}
          selectedAudioTrack={audio}
          selectedTextTrack={subtitle}
          textTracks={external}
          progressUpdateInterval={1000}
          playInBackground={false}
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
          }}
          onEnd={() => {
            state.current.ended = true;
            state.current.paused = true;
            setPaused(true);
          }}
          onPlaybackStateChanged={event => {
            state.current.paused = !event.isPlaying;
          }}
          onAudioTracks={event => {
            state.current.audio = event.audioTracks.map(track => ({
              id: String(track.index),
              label:
                track.title ?? track.language ?? `Audio ${track.index + 1}`,
            }));
          }}
          onTextTracks={event => {
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
const styles = StyleSheet.create({
  frame: {
    aspectRatio: 16 / 9,
    backgroundColor: '#000000',
    borderRadius: 8,
    overflow: 'hidden',
  },
  video: { flex: 1 },
});
