import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import { Button, Choice, Field, ProgressBar } from '../components/controls';
import { Cover } from '../components/Cover';
import { Relations } from '../components/Relations';
import { METADATA_GROUPS } from '../domain/catalog';
import { ui } from '../design/theme';
import { entryById, validLink, watchedPercent } from '../services/library';
import { addEpisode, removeEpisode, setWatched } from '../services/mutations';
import { Availability, MediaResolver } from '../services/media';

export function Details({
  workspace: w,
  animeId,
  navigate,
}: {
  workspace: Workspace;
  animeId: string;
  navigate: (route: Route) => void;
}): React.JSX.Element {
  const entry = w.catalog!.entries.find(e => e.id === animeId);
  const [tab, setTab] = useState<'details' | 'relations'>('details');
  const [title, setTitle] = useState('');
  const [link, setLink] = useState(entry?.link ?? '');
  const [availability, setAvailability] = useState<
    Record<string, Availability>
  >({});
  const [scan, setScan] = useState(0);
  const resolver = useMemo(
    () => (w.io ? new MediaResolver(w.io) : null),
    [w.io],
  );
  const current = useRef(w);
  current.current = w;
  useEffect(() => {
    let live = true;
    if (entry && resolver) {
      resolver.check(entry, current.current.settings).then(
        value => {
          if (live) {
            setAvailability(value);
          }
        },
        error => {
          if (live) {
            current.current.setError(String(error));
          }
        },
      );
    }
    return () => {
      live = false;
    };
  }, [entry, resolver, w.settings, scan]);
  if (!entry) {
    return (
      <View style={ui.page}>
        <Text style={ui.heading}>Title no longer exists</Text>
        <Button
          label="Anime library"
          onPress={() => navigate({ name: 'library', sectionId: 'anime' })}
        />
      </View>
    );
  }
  const action = (task: () => Promise<void>, message?: string) => {
    w.run(task, message).catch(w.setError);
  };
  const completed = entry.episodes.filter(ep => ep.watched).length;
  const available = Object.values(availability).filter(
    value => value.state === 'available',
  ).length;
  const latest = Object.values(w.catalog!.progress)
    .filter(p => p.entryId === entry.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const header = (
    <View style={ui.page}>
      <View style={ui.row}>
        <Button
          label="Details"
          primary={tab === 'details'}
          onPress={() => setTab('details')}
        />
        <Button
          label="Relations"
          primary={tab === 'relations'}
          onPress={() => setTab('relations')}
        />
      </View>
      {tab === 'details' ? (
        <>
          <View style={styles.hero}>
            <View style={styles.poster}>
              <Cover
                title={entry.title}
                uri={
                  entry.cover
                    ? `file://${w.io!.privateRoot}/${entry.cover}`
                    : null
                }
              />
              <Text style={ui.small}>
                {available} / {entry.episodes.length} local files available
              </Text>
            </View>
            <View style={[ui.grow, styles.summary]}>
              <Text accessibilityRole="header" style={ui.heading}>
                {entry.title}
              </Text>
              <Text style={ui.muted}>
                {entry.season} · {entry.episodes.length} episodes
              </Text>
              <Text style={ui.subheading}>
                {completed} completed · {Math.round(watchedPercent(entry))}%
              </Text>
              <ProgressBar
                value={watchedPercent(entry)}
                label="Title completion"
              />
              {latest && (
                <Text style={ui.muted}>
                  Last played: {latest.updatedAt.slice(0, 10)}
                </Text>
              )}
              <Choice
                label="Release status"
                values={['Ongoing', 'Completed', 'Not_Aired']}
                value={entry.status}
                onChange={value =>
                  action(() =>
                    w.mutate(c => {
                      entryById(c, entry.id).status =
                        value as typeof entry.status;
                    }),
                  )
                }
              />
              <Button
                label={
                  entry.watched
                    ? 'Mark all episodes unwatched'
                    : 'Mark all episodes watched'
                }
                onPress={() =>
                  action(() =>
                    w.mutate(c => setWatched(c, entry.id, !entry.watched)),
                  )
                }
              />
              <Button
                label={entry.bookmarked ? 'Bookmarked' : 'Bookmark'}
                onPress={() =>
                  action(() =>
                    w.mutate(c => {
                      entryById(c, entry.id).bookmarked = !entry.bookmarked;
                    }),
                  )
                }
              />
            </View>
          </View>
          <View style={ui.card}>
            <Text style={ui.subheading}>Links and local files</Text>
            <Button
              label="Open source link"
              onPress={() =>
                action(async () => {
                  await Linking.openURL(validLink(entry.link));
                }, 'Link opened')
              }
            />
            <Field label="Source link" value={link} onChange={setLink} />
            <Button
              label="Save link"
              onPress={() =>
                action(() =>
                  w.mutate(c => {
                    entryById(c, entry.id).link = validLink(link);
                  }),
                )
              }
            />
            <View style={ui.row}>
              {Platform.OS === 'windows' && (
                <Button
                  label="Open in Explorer"
                  onPress={() =>
                    action(async () => {
                      const folder = await resolver!.folder(entry, w.settings);
                      if (!folder) {
                        throw new Error(
                          'Select or relink the local media folder.',
                        );
                      }
                      await w.io!.reveal(folder);
                    }, 'Folder opened')
                  }
                />
              )}
              <Button
                label="Relink title folder"
                onPress={() =>
                  action(async () => {
                    const folder = await w.io!.pickFolder();
                    if (folder) {
                      await w.updateSettings(s => {
                        s.titleFolders[entry.id] = folder;
                      });
                      setScan(v => v + 1);
                    }
                  }, 'Folder linked')
                }
              />
              <Button
                label="Check local files"
                onPress={() => {
                  setAvailability({});
                  setScan(v => v + 1);
                }}
              />
            </View>
            <Text style={ui.small}>
              Folder locations belong to this device and are excluded from
              catalog exports.
            </Text>
          </View>
          <View style={ui.card}>
            {METADATA_GROUPS.map(group => (
              <View key={group}>
                <Text style={ui.muted}>{group}</Text>
                <Text style={ui.text}>
                  {entry.metadata[group].join(', ') || 'None'}
                </Text>
              </View>
            ))}
          </View>
          <Text style={ui.subheading}>Episodes</Text>
          <Field
            label="New episode title (optional)"
            value={title}
            onChange={setTitle}
          />
          <Button
            label="Add episode"
            primary
            onPress={() =>
              action(async () => {
                await w.mutate(c => addEpisode(c, entry.id, title));
                setTitle('');
              }, 'Episode added')
            }
          />
        </>
      ) : (
        <Relations workspace={w} entryId={entry.id} navigate={navigate} />
      )}
    </View>
  );
  return (
    <FlatList
      data={tab === 'details' ? entry.episodes : []}
      keyExtractor={ep => ep.id}
      ListHeaderComponent={header}
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={5}
      renderItem={({ item: ep }) => {
        const progress = w.catalog!.progress[ep.id];
        const state = availability[ep.id];
        const resume = !ep.watched && !!progress && progress.currentTime > 1;
        return (
          <View style={styles.episode}>
            <View style={ui.row}>
              <Text style={[ui.subheading, ui.grow]}>
                Episode {ep.number}: {ep.title}
              </Text>
              <Text style={ui.muted}>
                {ep.watched
                  ? 'Completed'
                  : resume
                  ? 'In progress'
                  : 'Unwatched'}
              </Text>
            </View>
            <Text style={ui.small}>
              {state?.state ?? 'Checking local file…'}
              {state && state.state !== 'available'
                ? ` · ${state.message}`
                : ''}
            </Text>
            <ProgressBar
              value={
                ep.watched
                  ? 100
                  : progress?.duration
                  ? (progress.currentTime / progress.duration) * 100
                  : 0
              }
              label={`Episode ${ep.number} progress`}
            />
            {progress && (
              <Text style={ui.small}>
                {Math.floor(progress.currentTime)} /{' '}
                {Math.floor(progress.duration)} seconds
              </Text>
            )}
            <View style={ui.row}>
              <Button
                label={resume ? 'Continue' : ep.watched ? 'Rewatch' : 'Play'}
                primary
                onPress={() =>
                  navigate({
                    name: 'player',
                    animeId: entry.id,
                    episodeId: ep.id,
                    resume,
                  })
                }
              />
              {resume && (
                <Button
                  label="Start Over"
                  onPress={() =>
                    navigate({
                      name: 'player',
                      animeId: entry.id,
                      episodeId: ep.id,
                      resume: false,
                    })
                  }
                />
              )}
              <Button
                label={ep.watched ? 'Mark unwatched' : 'Mark watched'}
                onPress={() =>
                  action(() =>
                    w.mutate(c => setWatched(c, entry.id, !ep.watched, ep.id)),
                  )
                }
              />
              <Button
                label="Locate file"
                onPress={() =>
                  action(async () => {
                    const file = (await w.io!.pickFiles('video'))[0];
                    if (file) {
                      await w.updateSettings(s => {
                        s.episodeFiles[ep.id] = file;
                      });
                      setScan(v => v + 1);
                    }
                  }, 'File linked')
                }
              />
              <Button
                label="Delete episode"
                danger
                onPress={() =>
                  Alert.alert(
                    'Delete episode record?',
                    `Episode ${ep.number} will be removed from the catalog. Its media file and the numbering of other episodes stay unchanged.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete record',
                        style: 'destructive',
                        onPress: () =>
                          action(
                            () =>
                              w.mutate(c => removeEpisode(c, entry.id, ep.id)),
                            'Episode removed',
                          ),
                      },
                    ],
                  )
                }
              />
            </View>
          </View>
        );
      }}
    />
  );
}
const styles = StyleSheet.create({
  hero: { flexDirection: 'row', flexWrap: 'wrap', gap: 24 },
  poster: { width: 190, gap: 8 },
  summary: { minWidth: 240, gap: 12 },
  episode: {
    marginHorizontal: 24,
    marginBottom: 16,
    padding: 16,
    borderRadius: 10,
    backgroundColor: '#303338',
    gap: 12,
  },
});
