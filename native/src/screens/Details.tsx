import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import { Button, Choice, ProgressBar, Sheet } from '../components/controls';
import { Cover, coverUri } from '../components/Cover';
import { PanelPage } from '../components/Fade';
import { IconButton } from '../components/Icon';
import { ActionMenu } from '../components/ActionMenu';
import { Relations } from '../components/Relations';
import { DetailsEditor } from '../components/DetailsEditor';
import { Episode, METADATA_GROUPS } from '../domain/catalog';
import {
  colors,
  displayFamily,
  fontFamily,
  ui,
  noFocusRing,
} from '../design/theme';
import { useViewport } from '../design/viewport';
import { entryById, validLink, watchedPercent } from '../services/library';
import { addEpisode, removeEpisode, setWatched } from '../services/mutations';
import { Availability, MediaResolver } from '../services/media';

const HOVER = Platform.OS === 'windows';
const detailTabs = new Map<string, 'details' | 'relations'>();

function Tab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={styles.tab}
    >
      <Text
        style={[
          styles.tabText,
          hover && styles.tabHover,
          active && styles.tabActive,
        ]}
      >
        {label}
      </Text>
      <View style={[styles.tabLine, active && styles.tabLineActive]} />
    </Pressable>
  );
}

function EpisodeRow({
  episode: ep,
  availability,
  percent,
  time,
  resume,
  phone,
  onPlay,
  onRestart,
  onToggle,
  onLocate,
  onDelete,
}: {
  episode: Episode;
  availability: Availability | undefined;
  percent: number;
  time: string | null;
  resume: boolean;
  phone: boolean;
  onPlay: () => void;
  onRestart: () => void;
  onToggle: () => void;
  onLocate: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const missing = availability && availability.state !== 'available';
  const status = ep.watched
    ? 'Completed'
    : resume
    ? 'In progress'
    : 'Unwatched';
  return (
    <Pressable
      {...noFocusRing}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      focusable={false}
      style={[styles.episode, hover && styles.episodeLit]}
    >
      <Text style={[styles.number, ep.watched && styles.numberDone]}>
        {ep.number}
      </Text>
      <Pressable
        {...noFocusRing}
        accessibilityRole="button"
        accessibilityLabel={`${
          resume ? 'Continue' : ep.watched ? 'Rewatch' : 'Play'
        } episode ${ep.number}`}
        onPress={onPlay}
        style={styles.episodeCopy}
      >
        <Text
          numberOfLines={1}
          style={[styles.episodeTitle, hover && styles.titleHover]}
        >
          {ep.title}
        </Text>
        <Text numberOfLines={1} style={ui.small}>
          {status}
          {time ? `, ${time}` : ''}
          {availability
            ? missing
              ? `, ${availability.message}`
              : ''
            : ', checking local file'}
        </Text>
        {percent > 0 && percent < 100 && (
          <View style={styles.episodeProgress}>
            <ProgressBar
              value={percent}
              label={`Episode ${ep.number} progress`}
            />
          </View>
        )}
      </Pressable>
      {/* Narrow screens keep watched and play in reach; the rest sit behind ⋯. */}
      {phone ? (
        <ActionMenu label={`More for episode ${ep.number}`}>
          {close => (
            <>
              {resume && (
                <IconButton
                  icon="reset"
                  label="Start over"
                  size={16}
                  onPress={() => {
                    close();
                    onRestart();
                  }}
                />
              )}
              <IconButton
                icon="search"
                label="Locate file"
                size={16}
                onPress={() => {
                  close();
                  onLocate();
                }}
              />
              <IconButton
                icon="trash"
                label="Delete episode"
                size={16}
                color={colors.danger}
                onPress={() => {
                  close();
                  onDelete();
                }}
              />
            </>
          )}
        </ActionMenu>
      ) : (
        <View style={[styles.episodeActions, HOVER && !hover && styles.hidden]}>
          {resume && (
            <IconButton
              icon="reset"
              label="Start over"
              size={16}
              onPress={onRestart}
            />
          )}
          <IconButton
            icon="search"
            label="Locate file"
            size={16}
            onPress={onLocate}
          />
          <IconButton
            icon="trash"
            label="Delete episode"
            size={16}
            color={colors.danger}
            onPress={onDelete}
          />
        </View>
      )}
      <IconButton
        icon="check"
        label={ep.watched ? 'Mark unwatched' : 'Mark watched'}
        size={16}
        color={ep.watched ? colors.success : colors.muted}
        onPress={onToggle}
      />
      <IconButton
        icon="play"
        label={resume ? 'Continue' : ep.watched ? 'Rewatch' : 'Play'}
        size={16}
        color={missing ? colors.muted : colors.chrome}
        onPress={onPlay}
      />
    </Pressable>
  );
}

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
  const [selection, setSelection] = useState(() => ({
    id: animeId,
    tab: detailTabs.get(animeId) ?? 'details',
  }));
  const tab =
    selection.id === animeId
      ? selection.tab
      : detailTabs.get(animeId) ?? 'details';
  const setTab = (value: 'details' | 'relations') => {
    detailTabs.set(animeId, value);
    setSelection({ id: animeId, tab: value });
  };
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [link, setLink] = useState(entry?.link ?? '');
  const [removing, setRemoving] = useState<Episode | null>(null);
  const [availability, setAvailability] = useState<
    Record<string, Availability>
  >({});
  const [scan, setScan] = useState(0);
  const { width } = useViewport();
  const phone = width < 700;
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
      <PanelPage>
        <Text style={ui.heading}>Title no longer exists</Text>
        <View style={styles.missing}>
          <Button
            label="Anime library"
            onPress={() => navigate({ name: 'library', sectionId: 'anime' })}
          />
        </View>
      </PanelPage>
    );
  }
  const action = (task: () => Promise<void>, message?: string) => {
    w.run(task, message).catch(w.setError);
  };
  const completed = entry.episodes.filter(ep => ep.watched).length;
  const percent = watchedPercent(entry);
  const available = Object.values(availability).filter(
    value => value.state === 'available',
  ).length;
  const latest = Object.values(w.catalog!.progress)
    .filter(p => p.entryId === entry.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return (
    <PanelPage>
      <View style={[styles.hero, phone && styles.heroPhone]}>
        <View style={[styles.poster, phone && styles.posterPhone]}>
          <Cover
            title={entry.title}
            uri={entry.cover ? coverUri(entry, w.io?.privateRoot) : null}
          />
        </View>
        <View style={styles.summary}>
          <Text
            accessibilityRole="header"
            style={[styles.title, phone && styles.titlePhone]}
          >
            {entry.title}
          </Text>
          <Text style={ui.muted}>
            {[entry.season, `${entry.episodes.length} episodes`]
              .filter(Boolean)
              .join(', ')}
          </Text>
          <View style={styles.tabs}>
            <Tab
              label="Details"
              active={tab === 'details'}
              onPress={() => setTab('details')}
            />
            <Tab
              label="Relations"
              active={tab === 'relations'}
              onPress={() => setTab('relations')}
            />
          </View>
          {tab === 'relations' && !phone && (
            <Relations workspace={w} entryId={entry.id} navigate={navigate} />
          )}
          {tab === 'details' && (
            <>
              <View style={styles.progress}>
                <Text style={ui.text}>
                  {completed} of {entry.episodes.length} watched
                </Text>
                <ProgressBar value={percent} label="Title completion" />
                <Text style={ui.small}>
                  {available} of {entry.episodes.length} local files available
                  {latest
                    ? `. Last played episode ${
                        entry.episodes.find(e => e.id === latest.episodeId)
                          ?.number ?? ''
                      } on ${latest.updatedAt.slice(0, 10)}`
                    : ''}
                </Text>
              </View>
              <View style={styles.actions}>
                <Button
                  label={entry.watched ? 'Watched' : 'Mark as watched'}
                  primary
                  success={entry.watched}
                  onPress={() =>
                    action(() =>
                      w.mutate(c => setWatched(c, entry.id, !entry.watched)),
                    )
                  }
                />
                <IconButton
                  icon="edit"
                  label="Edit title"
                  onPress={() => setEditing(true)}
                />
                <IconButton
                  icon={entry.bookmarked ? 'bookmarkFilled' : 'bookmark'}
                  label={entry.bookmarked ? 'Bookmarked' : 'Bookmark'}
                  onPress={() =>
                    action(() =>
                      w.mutate(c => {
                        entryById(c, entry.id).bookmarked = !entry.bookmarked;
                      }),
                    )
                  }
                />
                <IconButton
                  icon="link"
                  label="Open source link"
                  onPress={() =>
                    action(async () => {
                      await Linking.openURL(validLink(entry.link));
                    }, 'Link opened')
                  }
                />
                {Platform.OS === 'windows' && (
                  <IconButton
                    icon="folder"
                    label="Open in Explorer"
                    onPress={() =>
                      action(async () => {
                        const folder = await resolver!.folder(
                          entry,
                          w.settings,
                        );
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
                <IconButton
                  icon="reset"
                  label="Check local files"
                  onPress={() => {
                    setAvailability({});
                    setScan(v => v + 1);
                  }}
                />
              </View>
              <View style={styles.facts}>
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
                {METADATA_GROUPS.filter(
                  group => entry.metadata[group].length > 0,
                ).map(group => (
                  <View key={group} style={styles.fact}>
                    <Text style={ui.muted}>
                      {group.slice(0, 1).toUpperCase() + group.slice(1)}
                    </Text>
                    <Text style={styles.factValue}>
                      {entry.metadata[group].join(', ')}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      </View>
      {tab === 'relations' ? (
        phone && (
          <Relations workspace={w} entryId={entry.id} navigate={navigate} />
        )
      ) : (
        <>
          <View style={styles.source}>
            <TextInput
              {...noFocusRing}
              accessibilityLabel="Source link"
              placeholder="Source link"
              placeholderTextColor={colors.muted}
              value={link}
              onChangeText={setLink}
              style={[ui.input, ui.grow]}
            />
            <IconButton
              icon="check"
              label="Save link"
              size={16}
              onPress={() =>
                action(() =>
                  w.mutate(c => {
                    entryById(c, entry.id).link = validLink(link);
                  }),
                )
              }
            />
            <IconButton
              icon="folder"
              label="Relink title folder"
              size={16}
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
          </View>
          <Text style={ui.small}>
            Folder locations stay on this device and are left out of catalog
            exports.
          </Text>
          <View style={styles.episodesHead}>
            <Text
              accessibilityRole="header"
              style={[styles.episodesTitle, phone ? styles.fullRow : ui.grow]}
            >
              Episodes
            </Text>
            <TextInput
              {...noFocusRing}
              accessibilityLabel="New episode title (optional)"
              placeholder="New episode title (optional)"
              placeholderTextColor={colors.muted}
              value={title}
              onChangeText={setTitle}
              style={[ui.input, styles.addInput, phone && styles.addInputPhone]}
            />
            <IconButton
              icon="plus"
              label="Add episode"
              solid
              size={16}
              onPress={() =>
                action(async () => {
                  await w.mutate(c => addEpisode(c, entry.id, title));
                  setTitle('');
                }, 'Episode added')
              }
            />
          </View>
          <View style={styles.episodes}>
            {entry.episodes.map(ep => {
              const progress = w.catalog!.progress[ep.id];
              const resume =
                !ep.watched && !!progress && progress.currentTime > 1;
              return (
                <EpisodeRow
                  key={ep.id}
                  episode={ep}
                  availability={availability[ep.id]}
                  resume={resume}
                  phone={phone}
                  percent={
                    ep.watched
                      ? 100
                      : progress?.duration
                      ? (progress.currentTime / progress.duration) * 100
                      : 0
                  }
                  time={
                    progress
                      ? `${Math.floor(
                          progress.currentTime / 60,
                        )} of ${Math.floor(progress.duration / 60)} min`
                      : null
                  }
                  onPlay={() =>
                    navigate({
                      name: 'player',
                      animeId: entry.id,
                      episodeId: ep.id,
                      resume,
                    })
                  }
                  onRestart={() =>
                    navigate({
                      name: 'player',
                      animeId: entry.id,
                      episodeId: ep.id,
                      resume: false,
                    })
                  }
                  onToggle={() =>
                    action(() =>
                      w.mutate(c =>
                        setWatched(c, entry.id, !ep.watched, ep.id),
                      ),
                    )
                  }
                  onLocate={() =>
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
                  onDelete={() => setRemoving(ep)}
                />
              );
            })}
          </View>
        </>
      )}
      {editing && (
        <DetailsEditor
          key={entry.id}
          workspace={w}
          entry={entry}
          onClose={() => setEditing(false)}
        />
      )}
      <Sheet
        title="Delete episode record?"
        visible={removing !== null}
        onClose={() => setRemoving(null)}
      >
        <Text style={ui.text}>
          Episode {removing?.number} will be removed from the catalog. Its media
          file and the numbering of other episodes stay unchanged.
        </Text>
        <Button
          label="Delete record"
          danger
          onPress={() => {
            const ep = removing!;
            setRemoving(null);
            action(
              () => w.mutate(c => removeEpisode(c, entry.id, ep.id)),
              'Episode removed',
            );
          }}
        />
      </Sheet>
    </PanelPage>
  );
}
const styles = StyleSheet.create({
  missing: { marginTop: 16, alignItems: 'flex-start' },
  hero: { flexDirection: 'row', gap: 36, marginBottom: 28 },
  heroPhone: { flexDirection: 'column', gap: 16 },
  poster: { width: 300 },
  posterPhone: { width: 200, alignSelf: 'center' },
  summary: { flex: 1, gap: 6, flexBasis: 'auto' },
  title: {
    fontFamily: displayFamily,
    fontSize: 52,
    lineHeight: 58,
    fontWeight: '700',
    letterSpacing: -1.4,
    color: colors.text,
  },
  titlePhone: { fontFamily, fontSize: 32, lineHeight: 38, letterSpacing: -0.6 },
  tabs: { flexDirection: 'row', gap: 20, marginTop: 14, marginBottom: 18 },
  tab: { gap: 5 },
  tabText: { fontFamily, fontSize: 15, fontWeight: '600', color: colors.muted },
  tabHover: { color: colors.text },
  tabActive: { fontFamily, color: colors.accent },
  tabLine: { height: 2, backgroundColor: 'transparent' },
  tabLineActive: { backgroundColor: colors.accent },
  progress: { gap: 7, maxWidth: 620 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
  },
  facts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 36,
    rowGap: 12,
    marginTop: 18,
  },
  fact: { gap: 6 },
  factValue: { fontFamily, fontSize: 15, lineHeight: 22, color: colors.text },
  source: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  episodesHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 40,
    marginBottom: 10,
  },
  episodesTitle: {
    fontFamily: displayFamily,
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: -0.8,
    color: colors.text,
  },
  addInput: { fontFamily, width: 280 },
  // On phones the heading takes its own line and the field fills the next.
  fullRow: { width: '100%' },
  addInputPhone: { flex: 1, width: undefined },
  episodes: { borderTopWidth: 1, borderColor: colors.line },
  episodeLit: { backgroundColor: colors.rowHover },
  episode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  number: {
    width: 38,
    fontFamily: displayFamily,
    fontSize: 24,
    fontWeight: '300',
    textAlign: 'right',
    color: colors.text,
  },
  numberDone: { fontFamily, color: colors.success },
  episodeCopy: { flex: 1, gap: 2, paddingLeft: 6 },
  episodeTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  titleHover: { fontFamily, color: colors.mist },
  episodeProgress: { maxWidth: 320, marginTop: 4 },
  episodeActions: { flexDirection: 'row', gap: 2 },
  hidden: { opacity: 0 },
});
