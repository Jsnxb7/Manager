import React, {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  FlatList,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import {
  Entry,
  LibraryFilter,
  METADATA_GROUPS,
  PAGE_SIZES,
  emptyFilter,
} from '../domain/catalog';
import {
  Button,
  Choice,
  Field,
  ProgressBar,
  Sheet,
} from '../components/controls';
import { Cover } from '../components/Cover';
import { colors, ui } from '../design/theme';
import {
  entryById,
  filterEntries,
  metadataCatalog,
  validLink,
  watchedPercent,
} from '../services/library';
import {
  deleteLocalMedia,
  removeRecord,
  setWatched,
} from '../services/mutations';

export function Library({
  workspace: w,
  sectionId,
  navigate,
}: {
  workspace: Workspace;
  sectionId: string;
  navigate: (route: Route) => void;
}): React.JSX.Element {
  const section = w.catalog!.sections.find(s => s.id === sectionId)!;
  const [filter, setFilter] = useState<LibraryFilter>(
    () => w.settings.filters[sectionId] ?? emptyFilter(),
  );
  const [compact, setCompact] = useState(
    w.settings.compact[sectionId] ?? false,
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [metadata, setMetadata] = useState<Entry | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [link, setLink] = useState('');
  const workspace = useRef(w);
  workspace.current = w;
  const list = useRef<FlatList<Entry>>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      workspace.current
        .updateSettings(s => {
          s.filters[sectionId] = filter;
        })
        .catch(workspace.current.setError);
    }, 350);
    return () => clearTimeout(timer);
  }, [filter, sectionId]);
  const deferred = useDeferredValue(filter);
  const entries = useMemo(
    () => w.catalog!.entries.filter(e => e.sectionId === sectionId),
    [w.catalog, sectionId],
  );
  const found = useMemo(
    () => filterEntries(entries, deferred),
    [entries, deferred],
  );
  const catalog = useMemo(() => metadataCatalog(entries), [entries]);
  const totalPages = Math.max(1, Math.ceil(found.length / filter.pageSize));
  const page = Math.min(filter.page, totalPages);
  const visible = found.slice(
    (page - 1) * filter.pageSize,
    page * filter.pageSize,
  );
  const { width } = useWindowDimensions();
  const content = width - (width >= 900 ? 200 : 0) - 48;
  const columns = Math.max(
    1,
    Math.floor(
      content / (width < 600 ? (compact ? 130 : 145) : compact ? 150 : 200),
    ),
  );
  const update = (change: Partial<LibraryFilter>) =>
    setFilter(f => ({ ...f, ...change, page: change.page ?? 1 }));
  const action = (task: () => Promise<void>, message?: string) => {
    w.run(task, message).catch(w.setError);
  };
  const continuation = Object.values(w.catalog!.progress)
    .filter(
      p =>
        p.currentTime > 1 &&
        w.catalog!.entries.some(
          e => e.id === p.entryId && e.sectionId === sectionId,
        ),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const remove = (entry: Entry) =>
    Alert.alert(
      `Delete ${entry.title}?`,
      entry.kind === 'anime'
        ? `This deletes the linked local season folder (${entry.relativeFolder}) and its video files on this device, then removes the catalog record.`
        : 'Remove this catalog record and its artwork reference?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            action(async () => {
              await deleteLocalMedia(entry, w.settings, w.io!);
              await w.mutate(c => removeRecord(c, entry.id));
            }, 'Deleted'),
        },
      ],
    );
  const header = (
    <View style={styles.header}>
      <View style={ui.row}>
        <Text accessibilityRole="header" style={[ui.heading, ui.grow]}>
          {section.title}
        </Text>
        <Button
          label={`Add ${section.title}`}
          primary
          onPress={() => navigate({ name: 'add', sectionId })}
        />
      </View>
      <TextInput
        accessibilityLabel={`Search ${section.title}`}
        placeholder="Search titles, seasons and metadata"
        placeholderTextColor={colors.muted}
        value={filter.search}
        onChangeText={search => update({ search })}
        style={ui.input}
      />
      <View style={ui.row}>
        <Button label="Filters" onPress={() => setFiltersOpen(true)} />
        <Button
          label={compact ? 'Comfortable' : 'Compact'}
          onPress={() => {
            setCompact(v => !v);
            action(
              () =>
                w.updateSettings(s => {
                  s.compact[sectionId] = !compact;
                }),
              'Layout saved',
            );
          }}
        />
        <Button
          label="Top"
          onPress={() =>
            list.current?.scrollToOffset({ offset: 0, animated: false })
          }
        />
        {(['unread', 'ongoing', 'bookmarked'] as const).map(key => (
          <Button
            key={key}
            label={
              key === 'unread'
                ? section.kind === 'anime'
                  ? 'Unwatched'
                  : 'Unread'
                : key === 'ongoing'
                ? 'Ongoing'
                : 'Bookmarks'
            }
            primary={filter[key]}
            onPress={() => update({ [key]: !filter[key] })}
          />
        ))}
        <Button label="Reset" onPress={() => setFilter(emptyFilter())} />
      </View>
      <View style={ui.row}>
        {METADATA_GROUPS.flatMap(group =>
          filter.metadata[group].map(value => (
            <Button
              key={`${group}:${value}`}
              label={`${group}: ${value} ×`}
              onPress={() =>
                update({
                  metadata: {
                    ...filter.metadata,
                    [group]: filter.metadata[group].filter(v => v !== value),
                  },
                })
              }
            />
          )),
        )}
      </View>
      <Text style={ui.muted}>
        {found.length} matching · {entries.length} total
      </Text>
      {section.kind === 'anime' && continuation.length > 0 && (
        <>
          <Text style={ui.subheading}>Continue Watching</Text>
          <ScrollView horizontal contentContainerStyle={ui.row}>
            {continuation.map(progress => {
              const entry = w.catalog!.entries.find(
                e => e.id === progress.entryId,
              )!;
              const episode = entry.episodes.find(
                ep => ep.id === progress.episodeId,
              )!;
              return (
                <View key={progress.episodeId} style={styles.continue}>
                  <Text style={ui.text}>{entry.title}</Text>
                  <Text style={ui.muted}>
                    Episode {episode.number} ·{' '}
                    {Math.floor(progress.currentTime / 60)} min saved
                  </Text>
                  <ProgressBar
                    value={
                      progress.duration
                        ? (progress.currentTime / progress.duration) * 100
                        : 0
                    }
                    label="Episode progress"
                  />
                  <View style={ui.row}>
                    <Button
                      label="Continue"
                      primary
                      onPress={() =>
                        navigate({
                          name: 'player',
                          animeId: entry.id,
                          episodeId: episode.id,
                          resume: true,
                        })
                      }
                    />
                    <Button
                      label="Start Over"
                      onPress={() =>
                        navigate({
                          name: 'player',
                          animeId: entry.id,
                          episodeId: episode.id,
                          resume: false,
                        })
                      }
                    />
                    <Button
                      label="Discard"
                      onPress={() =>
                        action(
                          () =>
                            w.mutate(c => {
                              delete c.progress[episode.id];
                            }),
                          'Progress discarded',
                        )
                      }
                    />
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </>
      )}
    </View>
  );
  return (
    <>
      <FlatList
        ref={list}
        key={columns}
        data={visible}
        numColumns={columns}
        keyExtractor={entry => entry.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={header}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
        renderItem={({ item: entry }) => (
          <View style={[styles.card, { maxWidth: content / columns - 12 }]}>
            <Cover
              title={entry.title}
              uri={
                entry.cover
                  ? `file://${w.io!.privateRoot}/${entry.cover}`
                  : null
              }
            />
            <Text style={ui.subheading}>{entry.title}</Text>
            {entry.season !== '' && (
              <Text style={ui.muted}>{entry.season}</Text>
            )}
            <Text style={ui.muted}>{entry.status.replace('_', ' ')}</Text>
            <Button
              label={
                entry.kind === 'anime' ? 'View Anime' : `View ${section.title}`
              }
              primary
              onPress={() => {
                if (entry.kind === 'anime') {
                  navigate({ name: 'details', animeId: entry.id });
                } else {
                  action(async () => {
                    await Linking.openURL(validLink(entry.link));
                  }, 'Link opened');
                }
              }}
            />
            <View style={ui.row}>
              <Button
                label={entry.bookmarked ? 'Bookmarked' : 'Bookmark'}
                onPress={() =>
                  action(() =>
                    w.mutate(c => {
                      const item = entryById(c, entry.id);
                      item.bookmarked = !item.bookmarked;
                    }),
                  )
                }
              />
              <Button
                label={
                  (entry.kind === 'anime' ? entry.watched : entry.read)
                    ? entry.kind === 'anime'
                      ? 'Watched'
                      : 'Read'
                    : entry.kind === 'anime'
                    ? 'Mark watched'
                    : 'Mark read'
                }
                onPress={() =>
                  action(() =>
                    w.mutate(c => {
                      if (entry.kind === 'anime') {
                        setWatched(c, entry.id, !entry.watched);
                      } else {
                        entryById(c, entry.id).read = !entry.read;
                      }
                    }),
                  )
                }
              />
            </View>
            {entry.kind === 'anime' ? (
              <>
                <ProgressBar
                  value={watchedPercent(entry)}
                  label={`${entry.title} completion`}
                />
                <Button
                  label={
                    w.catalog!.queue.includes(entry.id)
                      ? 'Queued'
                      : 'Add to queue'
                  }
                  disabled={w.catalog!.queue.includes(entry.id)}
                  onPress={() =>
                    action(
                      () =>
                        w.mutate(c => {
                          if (!c.queue.includes(entry.id)) {
                            c.queue.push(entry.id);
                          }
                        }),
                      'Added to queue',
                    )
                  }
                />
              </>
            ) : (
              <>
                <Button
                  label="Edit link"
                  onPress={() => {
                    setEditing(entry);
                    setLink(entry.link);
                  }}
                />
                <Choice
                  label="Status"
                  values={['Ongoing', 'Completed', 'Hiatus']}
                  value={entry.status}
                  onChange={value =>
                    action(() =>
                      w.mutate(c => {
                        entryById(c, entry.id).status =
                          value as Entry['status'];
                      }),
                    )
                  }
                />
              </>
            )}
            <View style={ui.row}>
              {entry.kind !== 'custom' && (
                <Button label="Metadata" onPress={() => setMetadata(entry)} />
              )}
              <Button label="Delete" danger onPress={() => remove(entry)} />
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={ui.empty}>
            <Text style={ui.subheading}>
              {entries.length ? 'No matching items' : 'Your library is empty'}
            </Text>
            <Text style={ui.muted}>
              Add a title or import your catalog in Settings.
            </Text>
          </View>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Text style={ui.muted}>
              Page {page} of {totalPages}
            </Text>
            <View style={ui.row}>
              <Button
                label="Previous"
                disabled={page <= 1}
                onPress={() => update({ page: page - 1 })}
              />
              {Array.from(
                { length: Math.min(5, totalPages) },
                (_, index) =>
                  Math.max(1, Math.min(page - 2, totalPages - 4)) + index,
              ).map(value => (
                <Button
                  key={value}
                  label={String(value)}
                  primary={page === value}
                  onPress={() => update({ page: value })}
                />
              ))}
              <Button
                label="Next"
                disabled={page >= totalPages}
                onPress={() => update({ page: page + 1 })}
              />
            </View>
            <Choice
              label="Items per page"
              values={PAGE_SIZES.map(String)}
              value={String(filter.pageSize)}
              onChange={value =>
                update({ pageSize: Number(value) as LibraryFilter['pageSize'] })
              }
            />
          </View>
        }
      />
      <Sheet
        title="Filters"
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
      >
        {section.kind !== 'custom' &&
          METADATA_GROUPS.map(group => (
            <View key={group} style={ui.card}>
              <Text style={ui.subheading}>{group}</Text>
              <View style={ui.row}>
                {catalog[group].map(({ name, count }) => (
                  <Button
                    key={name}
                    label={`${name} (${count})`}
                    primary={filter.metadata[group].includes(name)}
                    onPress={() =>
                      update({
                        metadata: {
                          ...filter.metadata,
                          [group]: filter.metadata[group].includes(name)
                            ? filter.metadata[group].filter(v => v !== name)
                            : [...filter.metadata[group], name],
                        },
                      })
                    }
                  />
                ))}
              </View>
            </View>
          ))}
        <Button
          label="Reset filters"
          onPress={() => setFilter(emptyFilter())}
        />
      </Sheet>
      <Sheet
        title={metadata?.title ?? 'Metadata'}
        visible={metadata !== null}
        onClose={() => setMetadata(null)}
      >
        {metadata &&
          METADATA_GROUPS.map(group => (
            <View key={group}>
              <Text style={ui.subheading}>{group}</Text>
              <Text style={ui.text}>
                {metadata.metadata[group].join(', ') || 'None'}
              </Text>
            </View>
          ))}
      </Sheet>
      <Sheet
        title="Edit source link"
        visible={editing !== null}
        onClose={() => setEditing(null)}
      >
        <Field label="Link" value={link} onChange={setLink} />
        <Button
          label="Save link"
          primary
          onPress={() =>
            action(async () => {
              const value = validLink(link);
              await w.mutate(c => {
                entryById(c, editing!.id).link = value;
              });
              setEditing(null);
            })
          }
        />
      </Sheet>
    </>
  );
}
const styles = StyleSheet.create({
  header: { gap: 16, marginBottom: 16 },
  list: { padding: 24, paddingBottom: 48 },
  card: {
    flex: 1,
    backgroundColor: colors.panel,
    padding: 12,
    margin: 6,
    borderRadius: 10,
    gap: 10,
  },
  continue: {
    width: 320,
    padding: 16,
    gap: 10,
    backgroundColor: colors.panel,
    borderRadius: 10,
  },
  footer: { marginTop: 20, gap: 12 },
});
