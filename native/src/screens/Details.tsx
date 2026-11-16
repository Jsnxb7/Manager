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
import {
  Button,
  Choice,
  ProgressBar,
  Sheet,
  TextButton,
  ChipButton,
} from '../components/controls';
import { RatingScale } from '../components/Badges';
import { ReviewMatches } from '../components/ReviewMatches';
import { FolderMatch } from '../services/episodeMatch';
import {
  addFoundEpisodes,
  dismissNewEpisodes,
  forgetFound,
  newFor,
  recordTitle,
  useNewEpisodes,
} from '../services/newEpisodes';
import { Cover, coverUri } from '../components/Cover';
import { PanelPage, usePageState } from '../components/Fade';
import { PreviewSource, usePreview } from '../platform/usePreview';
import { IconButton } from '../components/Icon';
import { ActionMenu } from '../components/ActionMenu';
import { ContextMenu, useContextMenu } from '../components/ContextMenu';
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
  workspace,
  preview,
}: {
  workspace: Workspace;
  /** Hover clip on Windows; null when the file is not available. */
  preview: PreviewSource | null;
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
  const clip = usePreview(workspace, preview);
  const menu = useContextMenu();
  const missing = availability && availability.state !== 'available';
  const status = ep.watched
    ? 'Completed'
    : resume
    ? 'In progress'
    : 'Unwatched';
  return (
    <Pressable
      {...noFocusRing}
      ref={clip.ref}
      onHoverIn={() => {
        setHover(true);
        clip.onHoverIn();
      }}
      onHoverOut={() => {
        setHover(false);
        clip.onHoverOut();
      }}
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
        {...menu.pressProps}
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
      {/* Controls centre on the title and status lines, not the progress bar. */}
      <View style={styles.rail}>
        {/* Narrow screens keep watched and play in reach; the rest sit behind ⋯. */}
        {phone ? (
          <ActionMenu
            label={`More for episode ${ep.number}`}
            items={[
              ...(resume
                ? [
                    {
                      label: 'Start over',
                      icon: 'reset' as const,
                      onPress: onRestart,
                    },
                  ]
                : []),
              { label: 'Locate file', icon: 'search', onPress: onLocate },
              {
                label: 'Delete episode',
                icon: 'trash',
                onPress: onDelete,
                danger: true,
              },
            ]}
          />
        ) : (
          <View
            style={[styles.episodeActions, HOVER && !hover && styles.hidden]}
          >
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
      </View>
      <ContextMenu
        title={`Episode ${ep.number}`}
        visible={menu.visible}
        onClose={menu.close}
        items={[
          {
            label: resume ? 'Continue' : ep.watched ? 'Rewatch' : 'Play',
            icon: 'play',
            onPress: onPlay,
          },
          ...(resume
            ? [
                {
                  label: 'Start over',
                  icon: 'reset' as const,
                  onPress: onRestart,
                },
              ]
            : []),
          {
            label: ep.watched ? 'Mark as unwatched' : 'Mark as watched',
            icon: 'check',
            onPress: onToggle,
          },
          { label: 'Locate file', icon: 'search', onPress: onLocate },
          {
            label: 'Delete episode',
            icon: 'trash',
            onPress: onDelete,
            danger: true,
          },
        ]}
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
  // Kept through a window resize, which re-renders this page from scratch.
  const [editing, setEditing] = usePageState('editing', false);
  const [title, setTitle] = usePageState('title', '');
  const [composerFocus, setComposerFocus] = useState(false);
  const [link, setLink] = usePageState('link', entry?.link ?? '');
  const [removing, setRemoving] = usePageState<Episode | null>(
    'removing',
    null,
  );
  const [availability, setAvailability] = usePageState<
    Record<string, Availability>
  >('availability', {});
  const [folderMatch, setFolder] = usePageState<FolderMatch | null>(
    'folder',
    null,
  );
  const [reviewing, setReviewing] = usePageState('reviewing', false);
  const [notes, setNotes] = usePageState('notes', entry?.notes ?? '');
  const [scan, setScan] = useState(0);
  const found = useNewEpisodes();
  const { width } = useViewport();
  const phone = width < 700;
  // Tablets and narrow windows keep the poster smaller so the summary has room.
  const tablet = !phone && width < 1000;
  const resolver = useMemo(
    () => (w.io ? new MediaResolver(w.io) : null),
    [w.io],
  );
  const current = useRef(w);
  current.current = w;
  useEffect(() => {
    let live = true;
    if (entry && resolver) {
      resolver.scan(entry, current.current.settings).then(
        value => {
          if (live) {
            setAvailability(value.availability);
            setFolder(value.folder);
            if (value.folder && current.current.io) {
              recordTitle(
                current.current.io,
                entry.id,
                value.folder.newEpisodes,
              );
            }
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
  }, [entry, resolver, w.settings, scan, setAvailability, setFolder]);
  // Notes save shortly after typing stops, and when the field loses focus.
  const savedNotes = entry?.notes ?? '';
  const notesRef = useRef({ notes, savedNotes });
  notesRef.current = { notes, savedNotes };
  const saveNotes = () => {
    const value = notesRef.current;
    if (!entry || value.notes === value.savedNotes) {
      return;
    }
    current.current
      .mutate(c => {
        entryById(c, entry.id).notes = value.notes.slice(0, 20000);
      })
      .catch(current.current.setError);
  };
  useEffect(() => {
    const timer = setTimeout(saveNotes, 900);
    return () => clearTimeout(timer);
    // saveNotes reads the latest values through notesRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);
  useEffect(
    () => () => saveNotes(),
    // Leaving the page saves what is still waiting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
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
  const addNewEpisode = () =>
    action(async () => {
      await w.mutate(c => addEpisode(c, entry.id, title));
      setTitle('');
    }, 'Episode added');
  const completed = entry.episodes.filter(ep => ep.watched).length;
  const percent = watchedPercent(entry);
  const available = Object.values(availability).filter(
    value => value.state === 'available',
  ).length;
  const newEpisodes = newFor(found.scan, entry.id);
  const locate = (ep: Episode) =>
    action(async () => {
      const file = (await w.io!.pickFiles('video'))[0];
      if (file) {
        await w.updateSettings(s => {
          s.episodeFiles[ep.id] = file;
        });
        setScan(v => v + 1);
      }
    }, 'File linked');
  const latest = Object.values(w.catalog!.progress)
    .filter(p => p.entryId === entry.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return (
    <PanelPage
      onRefresh={async () => {
        setAvailability({});
        setScan(v => v + 1);
      }}
    >
      <View style={[styles.hero, phone && styles.heroPhone]}>
        <View
          style={[
            styles.poster,
            tablet && styles.posterTablet,
            phone && styles.posterPhone,
          ]}
        >
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
                  icon="refresh"
                  label="Check local files and new episodes"
                  onPress={() => {
                    setAvailability({});
                    setScan(v => v + 1);
                  }}
                />
              </View>
              <View style={styles.rating}>
                <Text style={ui.muted}>Your rating</Text>
                <RatingScale
                  value={entry.rating}
                  onChange={value =>
                    action(() =>
                      w.mutate(c => {
                        entryById(c, entry.id).rating = value;
                      }),
                    )
                  }
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
          <View style={styles.notes}>
            <Text accessibilityRole="header" style={styles.notesTitle}>
              Notes
            </Text>
            <TextInput
              {...noFocusRing}
              multiline
              accessibilityLabel="Notes"
              placeholder="Anything to remember about this title: where you stopped, who recommended it, what you thought."
              placeholderTextColor={colors.muted}
              value={notes}
              onChangeText={setNotes}
              onBlur={saveNotes}
              maxLength={20000}
              textAlignVertical="top"
              style={[ui.input, styles.notesInput]}
            />
            <Text style={ui.small}>
              {notes === savedNotes ? 'Saved with the title' : 'Saving…'}
            </Text>
          </View>
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
          {newEpisodes.length > 0 && (
            <View accessibilityRole="alert" style={styles.fresh}>
              <View style={styles.freshCopy}>
                <Text style={styles.freshTitle}>
                  {newEpisodes.length} new episode
                  {newEpisodes.length === 1 ? '' : 's'} in the folder
                </Text>
                <Text style={ui.small}>
                  {newEpisodes.length === 1 ? 'Episode ' : 'Episodes '}
                  {newEpisodes.map(n => n.number).join(', ')}, found in the
                  title folder but not listed yet.
                </Text>
              </View>
              <Button
                label={`Add ${newEpisodes.length === 1 ? 'it' : 'them'}`}
                primary
                onPress={() =>
                  action(async () => {
                    await w.mutate(c => {
                      addFoundEpisodes(c, entry.id, newEpisodes);
                    });
                    await forgetFound(w.io!, entry.id);
                    setScan(v => v + 1);
                  }, `Added ${newEpisodes.length} episode${newEpisodes.length === 1 ? '' : 's'}`)
                }
              />
              <TextButton
                label="Not now"
                onPress={() =>
                  action(() => dismissNewEpisodes(w.io!, entry.id))
                }
              />
            </View>
          )}
          <View style={styles.episodesHead}>
            <View
              style={[
                styles.episodesTitleRow,
                phone ? styles.fullRow : ui.grow,
              ]}
            >
              <Text accessibilityRole="header" style={styles.episodesTitle}>
                Episodes
              </Text>
              <Text style={styles.episodesCount}>
                {entry.episodes.filter(ep => ep.watched).length} of{' '}
                {entry.episodes.length} watched
              </Text>
            </View>
            <ChipButton
              icon="search"
              label="Review matches"
              onPress={() => setReviewing(true)}
            />
            <View
              style={[
                styles.composer,
                composerFocus && styles.composerFocus,
                phone && styles.addInputPhone,
              ]}
            >
              <TextInput
                {...noFocusRing}
                accessibilityLabel="New episode title (optional)"
                placeholder={`Episode ${
                  entry.episodes.length + 1
                } title (optional)`}
                placeholderTextColor={colors.muted}
                value={title}
                onChangeText={setTitle}
                onFocus={() => setComposerFocus(true)}
                onBlur={() => setComposerFocus(false)}
                onSubmitEditing={addNewEpisode}
                style={styles.composerInput}
              />
              <ChipButton
                icon="plus"
                label="Add episode"
                primary
                onPress={addNewEpisode}
              />
            </View>
          </View>
          <View style={styles.episodes}>
            {entry.episodes.map(ep => {
              const progress = w.catalog!.progress[ep.id];
              const resume =
                !ep.watched && !!progress && progress.currentTime > 1;
              return (
                <EpisodeRow
                  key={ep.id}
                  workspace={w}
                  preview={
                    availability[ep.id]?.state === 'available'
                      ? {
                          entryId: entry.id,
                          episodeId: ep.id,
                          start: progress?.currentTime ?? 0,
                        }
                      : null
                  }
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
                  onLocate={() => locate(ep)}
                  onDelete={() => setRemoving(ep)}
                />
              );
            })}
          </View>
        </>
      )}
      <ReviewMatches
        visible={reviewing}
        onClose={() => setReviewing(false)}
        episodes={entry.episodes}
        availability={availability}
        folder={folderMatch}
        onLocate={locate}
      />
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
// Height of an episode's title and status lines, which the row's controls centre on.
const EPISODE_LINES = 40;

const styles = StyleSheet.create({
  missing: { marginTop: 16, alignItems: 'flex-start' },
  hero: { flexDirection: 'row', gap: 36, marginBottom: 28 },
  heroPhone: { flexDirection: 'column', gap: 16 },
  poster: { width: 300 },
  posterTablet: { width: 220 },
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
  rating: { gap: 6, marginTop: 18 },
  notes: { gap: 8, marginTop: 36, marginBottom: 24, maxWidth: 760 },
  notesTitle: {
    fontFamily,
    fontSize: 22,
    fontWeight: '600',
    color: colors.text,
  },
  notesInput: { minHeight: 96, paddingTop: 10, lineHeight: 20 },
  fresh: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginTop: 32,
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  freshCopy: { flexGrow: 1, flexBasis: 240, gap: 3 },
  freshTitle: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    color: colors.mist,
  },
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
    lineHeight: 42,
    fontWeight: '700',
    letterSpacing: -0.8,
    color: colors.text,
  },
  // Windows does not honour baseline alignment, so the count sits on the title's
  // baseline by padding instead.
  episodesTitleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  episodesCount: {
    fontFamily,
    fontSize: 14,
    lineHeight: 18,
    paddingBottom: 5,
    color: colors.muted,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 340,
    maxWidth: '100%',
    minHeight: 42,
    paddingLeft: 14,
    paddingRight: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#0E1A26',
  },
  composerFocus: { borderColor: colors.accent },
  composerInput: {
    flex: 1,
    fontFamily,
    fontSize: 14,
    color: colors.text,
    paddingVertical: 8,
  },
  // On phones the heading takes its own line and the field fills the next.
  fullRow: { width: '100%' },
  addInputPhone: { flex: 1, width: undefined, minWidth: 220 },
  episodes: { borderTopWidth: 1, borderColor: colors.line },
  episodeLit: { backgroundColor: colors.rowHover },
  episode: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  number: {
    width: 38,
    height: EPISODE_LINES,
    lineHeight: EPISODE_LINES,
    textAlignVertical: 'center',
    fontFamily: displayFamily,
    fontSize: 24,
    fontWeight: '300',
    textAlign: 'right',
    color: colors.text,
  },
  numberDone: { fontFamily, color: colors.success },
  episodeCopy: {
    flex: 1,
    minWidth: 0,
    minHeight: EPISODE_LINES,
    justifyContent: 'center',
    gap: 2,
    paddingLeft: 6,
  },
  rail: {
    flexDirection: 'row',
    alignItems: 'center',
    height: EPISODE_LINES,
    gap: 2,
  },
  episodeTitle: {
    fontFamily,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.text,
  },
  titleHover: { fontFamily, color: colors.mist },
  episodeProgress: { maxWidth: 320, marginTop: 6 },
  episodeActions: { flexDirection: 'row', gap: 2 },
  hidden: { opacity: 0 },
});
