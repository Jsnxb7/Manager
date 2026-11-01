import React, {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import { SearchBar } from '../components/NavBar';
import {
  Entry,
  LibraryFilter,
  METADATA_GROUPS,
  PAGE_SIZES,
  Section,
  emptyFilter,
} from '../domain/catalog';
import {
  Button,
  Choice,
  Field,
  ProgressBar,
  Sheet,
  TextButton,
} from '../components/controls';
import { Cover, coverUri } from '../components/Cover';
import { PanelPage } from '../components/Fade';
import { Icon, IconButton } from '../components/Icon';
import {
  colors,
  displayFamily,
  fontFamily,
  ui,
  noFocusRing,
} from '../design/theme';
import { useViewport } from '../design/viewport';
import {
  entryById,
  filterEntries,
  metadataCatalog,
  validLink,
  watchedPercent,
} from '../services/library';
import {
  deleteEntry,
  resolvedDeleteTarget,
  setWatched,
} from '../services/mutations';

// Coming back to a library returns to where it was left, for this session.
const scrollPositions = new Map<string, number>();

// Touch screens have no hover, so overlay actions stay reachable there.
const HOVER = Platform.OS === 'windows';

function TextToggle(props: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return <TextButton {...props} />;
}

function WatchedButton({
  entry,
  onPress,
}: {
  entry: Entry;
  onPress: () => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const anime = entry.kind === 'anime';
  const done = anime ? entry.watched : entry.read;
  const label = done
    ? anime
      ? 'Watched'
      : 'Read'
    : anime
    ? 'Mark as watched'
    : 'Mark as read';
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${entry.title}`}
      accessibilityState={{ selected: done }}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={[
        styles.watched,
        done && styles.watchedDone,
        hover && styles.watchedHover,
      ]}
    >
      <Icon
        name="check"
        size={14}
        color={hover ? colors.background : done ? colors.success : colors.text}
      />
      <Text
        style={[
          styles.watchedText,
          done && styles.watchedDoneText,
          hover && styles.watchedHoverText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type CardProps = {
  entry: Entry;
  section: Section;
  queued: boolean;
  uri: string | null;
  onOpen: () => void;
  onToggleWatched: () => void;
  onBookmark: () => void;
  onQueue: () => void;
  onMetadata: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function Actions({
  entry,
  queued,
  size,
  onBookmark,
  onQueue,
  onMetadata,
  onEdit,
  onDelete,
  solid,
}: CardProps & { size: number; solid: boolean }): React.JSX.Element {
  return (
    <>
      <IconButton
        icon={entry.bookmarked ? 'bookmarkFilled' : 'bookmark'}
        label={entry.bookmarked ? 'Bookmarked' : 'Bookmark'}
        size={size}
        solid={solid}
        onPress={onBookmark}
      />
      {entry.kind === 'anime' ? (
        <IconButton
          icon="queue"
          label={queued ? 'Queued' : 'Add to queue'}
          size={size}
          solid={solid}
          disabled={queued}
          onPress={onQueue}
        />
      ) : (
        <IconButton
          icon="link"
          label="Edit link"
          size={size}
          solid={solid}
          onPress={onEdit}
        />
      )}
      {entry.kind !== 'custom' && (
        <IconButton
          icon="tag"
          label="Metadata"
          size={size}
          solid={solid}
          onPress={onMetadata}
        />
      )}
      <IconButton
        icon="trash"
        label="Delete"
        size={size}
        solid={solid}
        color={colors.danger}
        onPress={onDelete}
      />
    </>
  );
}

function subtitle(entry: Entry): string {
  const status = entry.status.replace('_', ' ');
  return entry.season ? `${entry.season}, ${status}` : status;
}

function GridCard(props: CardProps & { width: number }): React.JSX.Element {
  const { entry, uri, width, onOpen, onToggleWatched } = props;
  const [hover, setHover] = useState(false);
  const percent = entry.kind === 'anime' ? watchedPercent(entry) : 0;
  return (
    <Pressable
      {...noFocusRing}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      focusable={false}
      style={[styles.card, { width }]}
    >
      <Pressable
        {...noFocusRing}
        accessibilityRole="link"
        accessibilityLabel={`Open ${entry.title}`}
        onPress={onOpen}
      >
        <Cover uri={uri} title={entry.title}>
          {entry.bookmarked && !hover && (
            <View style={styles.mark}>
              <Icon name="bookmarkFilled" size={16} color={colors.chrome} />
            </View>
          )}
          {(hover || !HOVER) && (
            <View style={styles.overlay}>
              <Actions {...props} size={14} solid />
            </View>
          )}
        </Cover>
      </Pressable>
      <Pressable
        {...noFocusRing}
        accessibilityRole="link"
        accessibilityLabel={entry.title}
        onPress={onOpen}
      >
        <Text
          numberOfLines={2}
          style={[styles.cardTitle, hover && styles.cardTitleHover]}
        >
          {entry.title}
        </Text>
      </Pressable>
      <Text numberOfLines={1} style={ui.small}>
        {subtitle(entry)}
      </Text>
      {percent > 0 && percent < 100 && (
        <ProgressBar value={percent} label={`${entry.title} completion`} />
      )}
      <WatchedButton entry={entry} onPress={onToggleWatched} />
    </Pressable>
  );
}

function ListRow(props: CardProps & { phone: boolean }): React.JSX.Element {
  const { entry, uri, phone, onOpen, onToggleWatched } = props;
  const [hover, setHover] = useState(false);
  const percent = entry.kind === 'anime' ? watchedPercent(entry) : 0;
  return (
    <Pressable
      {...noFocusRing}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      focusable={false}
      style={[styles.rowItem, hover && styles.rowLit]}
    >
      <Pressable
        {...noFocusRing}
        accessibilityRole="link"
        accessibilityLabel={`Open ${entry.title}`}
        onPress={onOpen}
        style={styles.rowCover}
      >
        <Cover uri={uri} title={entry.title} />
      </Pressable>
      <View style={styles.rowCopy}>
        <Pressable
          {...noFocusRing}
          accessibilityRole="link"
          accessibilityLabel={entry.title}
          onPress={onOpen}
        >
          <Text
            numberOfLines={1}
            style={[styles.rowTitle, hover && styles.cardTitleHover]}
          >
            {entry.title}
          </Text>
        </Pressable>
        <Text numberOfLines={1} style={ui.small}>
          {subtitle(entry)}
          {entry.kind === 'anime' ? `, ${Math.round(percent)}% watched` : ''}
        </Text>
        {percent > 0 && percent < 100 && (
          <View style={styles.rowProgress}>
            <ProgressBar value={percent} label={`${entry.title} completion`} />
          </View>
        )}
      </View>
      {!phone && (
        <View style={[styles.rowActions, !hover && styles.hidden]}>
          <Actions {...props} size={16} solid={false} />
        </View>
      )}
      <WatchedButton entry={entry} onPress={onToggleWatched} />
    </Pressable>
  );
}

function ContinueItem({
  title,
  uri,
  detail,
  percent,
  onContinue,
  onRestart,
  onDiscard,
}: {
  title: string;
  uri: string | null;
  detail: string;
  percent: number;
  onContinue: () => void;
  onRestart: () => void;
  onDiscard: () => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      {...noFocusRing}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      focusable={false}
      style={styles.continue}
    >
      <Pressable
        {...noFocusRing}
        accessibilityRole="button"
        accessibilityLabel={`Continue ${title}`}
        onPress={onContinue}
        style={styles.continueCover}
      >
        <Cover uri={uri} title={title} />
      </Pressable>
      <View style={styles.continueCopy}>
        <Text numberOfLines={2} style={styles.rowTitle}>
          {title}
        </Text>
        <Text style={ui.small}>{detail}</Text>
        <ProgressBar value={percent} label="Episode progress" />
        <View
          style={[styles.continueActions, HOVER && !hover && styles.hidden]}
        >
          <IconButton
            icon="play"
            label="Continue"
            size={14}
            onPress={onContinue}
          />
          <IconButton
            icon="reset"
            label="Start over"
            size={14}
            onPress={onRestart}
          />
          <IconButton
            icon="close"
            label="Discard"
            size={14}
            onPress={onDiscard}
          />
        </View>
      </View>
    </Pressable>
  );
}

export function Library({
  workspace: w,
  sectionId,
  navigate,
  filtersOpen,
  onSearchBar,
  onCloseFilters,
  onFilterCount,
}: {
  workspace: Workspace;
  sectionId: string;
  navigate: (route: Route) => void;
  filtersOpen: boolean;
  onSearchBar: (bar: SearchBar | null) => void;
  onCloseFilters: () => void;
  onFilterCount: (count: number) => void;
}): React.JSX.Element {
  const section = w.catalog!.sections.find(s => s.id === sectionId)!;
  const [filter, setFilter] = useState<LibraryFilter>(
    () => w.settings.filters[sectionId] ?? emptyFilter(),
  );
  const [listView, setListView] = useState(
    w.settings.compact[sectionId] ?? false,
  );
  const [metadata, setMetadata] = useState<Entry | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [removing, setRemoving] = useState<Entry | null>(null);
  const [removeFolder, setRemoveFolder] = useState<string | null | undefined>(
    undefined,
  );
  const [link, setLink] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const workspace = useRef(w);
  workspace.current = w;
  const scroller = useRef<ScrollView>(null);
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
  // Leaving quickly must not lose a change still waiting for the timer above.
  const latestFilter = useRef(filter);
  latestFilter.current = filter;
  useEffect(
    () => () => {
      workspace.current
        .updateSettings(s => {
          s.filters[sectionId] = latestFilter.current;
        })
        .catch(() => undefined);
    },
    [sectionId],
  );
  useEffect(() => {
    const saved = scrollPositions.get(sectionId);
    if (saved) {
      const timer = setTimeout(
        () => scroller.current?.scrollTo({ y: saved, animated: false }),
        60,
      );
      return () => clearTimeout(timer);
    }
  }, [sectionId]);
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
  const activeTags = METADATA_GROUPS.flatMap(group =>
    filter.metadata[group].map(value => ({ group, value })),
  );
  const activeCount =
    activeTags.length +
    (filter.unread ? 1 : 0) +
    (filter.ongoing ? 1 : 0) +
    (filter.bookmarked ? 1 : 0);
  useEffect(() => onFilterCount(activeCount), [activeCount, onFilterCount]);
  const { width } = useViewport();
  const phone = width < 700;
  // Window metrics can disagree with layout under display scaling, so measure.
  const [measured, setMeasured] = useState(0);
  const inner = measured || width - (phone ? 44 : 168);
  const gap = phone ? 12 : 20;
  const columns = Math.max(2, Math.floor((inner + gap) / (phone ? 150 : 196)));
  const cardWidth = Math.floor((inner - gap * (columns - 1)) / columns);
  // The grid rounds up to whole rows so a page never ends on a stray title.
  const perPage = listView
    ? filter.pageSize
    : Math.ceil(filter.pageSize / columns) * columns;
  const totalPages = Math.max(1, Math.ceil(found.length / perPage));
  const page = Math.min(filter.page, totalPages);
  const visible = found.slice((page - 1) * perPage, page * perPage);
  const setSearch = useRef((search: string) => {
    setFilter(f => ({ ...f, search, page: 1 }));
  }).current;
  useEffect(() => {
    onSearchBar({
      value: filter.search,
      onChange: setSearch,
      placeholder: `Search ${section.title}`,
    });
  }, [filter.search, onSearchBar, section.title, setSearch]);
  useEffect(
    () => () => {
      onSearchBar(null);
      onCloseFilters();
    },
    [onSearchBar, onCloseFilters],
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
  const confirmRemove = (entry: Entry) => {
    setRemoving(null);
    action(async () => {
      await deleteEntry(entry, w.settings, w.io!, w.mutate);
    }, 'Deleted');
  };
  const cardProps = (entry: Entry): CardProps => ({
    entry,
    section,
    queued: w.catalog!.queue.includes(entry.id),
    uri: entry.cover ? coverUri(entry, w.io?.privateRoot) : null,
    onOpen: () => {
      if (entry.kind === 'anime') {
        navigate({ name: 'details', animeId: entry.id });
      } else {
        action(async () => {
          await Linking.openURL(validLink(entry.link));
        }, 'Link opened');
      }
    },
    onToggleWatched: () =>
      action(() =>
        w.mutate(c => {
          if (entry.kind === 'anime') {
            setWatched(c, entry.id, !entry.watched);
          } else {
            entryById(c, entry.id).read = !entry.read;
          }
        }),
      ),
    onBookmark: () =>
      action(() =>
        w.mutate(c => {
          const item = entryById(c, entry.id);
          item.bookmarked = !item.bookmarked;
        }),
      ),
    onQueue: () =>
      action(
        () =>
          w.mutate(c => {
            if (!c.queue.includes(entry.id)) {
              c.queue.push(entry.id);
            }
          }),
        'Added to queue',
      ),
    onMetadata: () => setMetadata(entry),
    onEdit: () => {
      setEditing(entry);
      setLink(entry.link);
    },
    onDelete: () => {
      setRemoving(entry);
      setRemoveFolder(undefined);
      resolvedDeleteTarget(entry, w.settings, w.io!)
        .then(target => setRemoveFolder(target?.relativePath ?? null))
        .catch(w.setError);
    },
  });
  const chooseView = (next: boolean) => {
    setListView(next);
    action(
      () =>
        w.updateSettings(s => {
          s.compact[sectionId] = next;
        }),
      'Layout saved',
    );
  };
  return (
    <PanelPage
      scrollRef={scroller}
      onScrollY={y => scrollPositions.set(sectionId, y)}
    >
      <View
        style={styles.header}
        onLayout={e => setMeasured(Math.floor(e.nativeEvent.layout.width))}
      >
        <View style={ui.grow}>
          <Text
            accessibilityRole="header"
            style={[styles.hero, phone && styles.heroPhone]}
          >
            {section.title}
          </Text>
          <Text style={ui.muted}>
            {visible.length
              ? `Showing ${(page - 1) * perPage + 1}-${
                  (page - 1) * perPage + visible.length
                } of ${found.length}`
              : '0 titles'}
          </Text>
        </View>
        <IconButton
          icon="grid"
          label="Grid view"
          active={!listView}
          onPress={() => chooseView(false)}
        />
        <IconButton
          icon="list"
          label="List view"
          active={listView}
          onPress={() => chooseView(true)}
        />
        <IconButton
          icon="plus"
          label={`Add ${section.title}`}
          solid
          onPress={() => navigate({ name: 'add', sectionId })}
        />
      </View>
      <Sheet
        title="Filters"
        drawer
        visible={filtersOpen}
        onClose={onCloseFilters}
      >
        <View style={styles.filterHead}>
          <Text style={ui.muted}>
            {found.length} of {entries.length} titles
          </Text>
          <TextToggle
            label="Reset filters"
            active={false}
            onPress={() => setFilter(emptyFilter())}
          />
        </View>
        <View style={styles.filterGroup}>
          <Text style={ui.subheading}>Show only</Text>
          <View style={styles.filterValues}>
            {(['unread', 'ongoing', 'bookmarked'] as const).map(key => (
              <TextToggle
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
                active={filter[key]}
                onPress={() => update({ [key]: !filter[key] })}
              />
            ))}
          </View>
        </View>
        {section.kind !== 'custom' &&
          METADATA_GROUPS.filter(g => catalog[g].length > 0).map(group => {
            const all = catalog[group];
            const expanded = expandedGroups.includes(group);
            // Selected values stay visible even when the group is collapsed.
            const shown = expanded
              ? all
              : all.filter(
                  (item, index) =>
                    index < 12 || filter.metadata[group].includes(item.name),
                );
            return (
              <View key={group} style={styles.filterGroup}>
                <View style={ui.rule} />
                <Text style={ui.subheading}>
                  {group.slice(0, 1).toUpperCase() + group.slice(1)}
                </Text>
                <View style={styles.filterValues}>
                  {shown.map(({ name, count }) => (
                    <TextToggle
                      key={name}
                      label={`${name} ${count}`}
                      active={filter.metadata[group].includes(name)}
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
                {all.length > 12 && (
                  <View style={styles.filterMore}>
                    <TextToggle
                      label={expanded ? 'Show fewer' : `Show all ${all.length}`}
                      active={false}
                      onPress={() =>
                        setExpandedGroups(list =>
                          expanded
                            ? list.filter(g => g !== group)
                            : [...list, group],
                        )
                      }
                    />
                  </View>
                )}
              </View>
            );
          })}
      </Sheet>
      {(activeCount > 0 || filter.search !== '') && (
        <View style={styles.active}>
          {filter.search !== '' && (
            <TextToggle
              label={`Search: ${filter.search} ×`}
              active
              onPress={() => update({ search: '' })}
            />
          )}
          {(['unread', 'ongoing', 'bookmarked'] as const).map(key =>
            filter[key] ? (
              <TextToggle
                key={key}
                label={`${
                  key === 'unread'
                    ? section.kind === 'anime'
                      ? 'Unwatched'
                      : 'Unread'
                    : key === 'ongoing'
                    ? 'Ongoing'
                    : 'Bookmarks'
                } ×`}
                active
                onPress={() => update({ [key]: false })}
              />
            ) : null,
          )}
          {activeTags.map(({ group, value }) => (
            <TextToggle
              key={`${group}:${value}`}
              label={`${value} ×`}
              active
              onPress={() =>
                update({
                  metadata: {
                    ...filter.metadata,
                    [group]: filter.metadata[group].filter(v => v !== value),
                  },
                })
              }
            />
          ))}
        </View>
      )}
      {section.kind === 'anime' && continuation.length > 0 && (
        <View style={styles.block}>
          <Text style={ui.subheading}>Continue watching</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.continueRow}
          >
            {continuation.map(progress => {
              const entry = w.catalog!.entries.find(
                e => e.id === progress.entryId,
              )!;
              const episode = entry.episodes.find(
                ep => ep.id === progress.episodeId,
              )!;
              return (
                <ContinueItem
                  key={progress.episodeId}
                  title={entry.title}
                  uri={entry.cover ? coverUri(entry, w.io?.privateRoot) : null}
                  detail={`Episode ${episode.number}, ${Math.floor(
                    progress.currentTime / 60,
                  )} min in`}
                  percent={
                    progress.duration
                      ? (progress.currentTime / progress.duration) * 100
                      : 0
                  }
                  onContinue={() =>
                    navigate({
                      name: 'player',
                      animeId: entry.id,
                      episodeId: episode.id,
                      resume: true,
                    })
                  }
                  onRestart={() =>
                    navigate({
                      name: 'player',
                      animeId: entry.id,
                      episodeId: episode.id,
                      resume: false,
                    })
                  }
                  onDiscard={() =>
                    action(
                      () =>
                        w.mutate(c => {
                          delete c.progress[episode.id];
                        }),
                      'Progress discarded',
                    )
                  }
                />
              );
            })}
          </ScrollView>
        </View>
      )}
      {visible.length === 0 ? (
        <View style={ui.empty}>
          <Text style={ui.subheading}>
            {entries.length ? 'No matching titles' : 'This library is empty'}
          </Text>
          <Text style={ui.muted}>
            {entries.length
              ? 'Change your search or filters to see more.'
              : 'Add a title, or import your catalog in Settings.'}
          </Text>
        </View>
      ) : listView ? (
        <View style={styles.list}>
          {visible.map(entry => (
            <ListRow key={entry.id} {...cardProps(entry)} phone={phone} />
          ))}
        </View>
      ) : (
        <View style={[styles.grid, { gap }]}>
          {visible.map(entry => (
            <GridCard key={entry.id} {...cardProps(entry)} width={cardWidth} />
          ))}
        </View>
      )}
      {visible.length > 0 && (
        <View style={styles.footer}>
          <IconButton
            icon="back"
            label="Previous"
            disabled={page <= 1}
            onPress={() => update({ page: page - 1 })}
          />
          {Array.from(
            { length: Math.min(5, totalPages) },
            (_, index) =>
              Math.max(1, Math.min(page - 2, totalPages - 4)) + index,
          ).map(value => (
            <TextToggle
              key={value}
              label={String(value)}
              active={page === value}
              onPress={() => update({ page: value })}
            />
          ))}
          <IconButton
            icon="forward"
            label="Next"
            disabled={page >= totalPages}
            onPress={() => update({ page: page + 1 })}
          />
          <View style={ui.grow} />
          <Choice
            inline
            row
            label="Per page"
            values={PAGE_SIZES.map(String)}
            value={String(filter.pageSize)}
            display={String(perPage)}
            onChange={value =>
              update({ pageSize: Number(value) as LibraryFilter['pageSize'] })
            }
          />
          <IconButton
            icon="up"
            label="Back to top"
            onPress={() => scroller.current?.scrollTo({ y: 0, animated: true })}
          />
        </View>
      )}
      <Sheet
        title={metadata?.title ?? 'Metadata'}
        visible={metadata !== null}
        onClose={() => setMetadata(null)}
      >
        {metadata &&
          METADATA_GROUPS.map(group => (
            <View key={group} style={styles.metaGroup}>
              <Text style={ui.muted}>
                {group.slice(0, 1).toUpperCase() + group.slice(1)}
              </Text>
              <Text style={ui.text}>
                {metadata.metadata[group].join(', ') || 'None'}
              </Text>
            </View>
          ))}
      </Sheet>
      <Sheet
        title={editing?.title ?? 'Edit source link'}
        visible={editing !== null}
        onClose={() => setEditing(null)}
      >
        <Field label="Link" value={link} onChange={setLink} />
        {editing && (
          <Choice
            label="Status"
            values={['Ongoing', 'Completed', 'Hiatus']}
            value={
              w.catalog!.entries.find(e => e.id === editing.id)?.status ??
              editing.status
            }
            onChange={value =>
              action(() =>
                w.mutate(c => {
                  entryById(c, editing.id).status = value as Entry['status'];
                }),
              )
            }
          />
        )}
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
      <Sheet
        title={removing ? `Delete ${removing.title}?` : 'Delete'}
        visible={removing !== null}
        onClose={() => setRemoving(null)}
      >
        <Text style={ui.text}>
          {removeFolder
            ? `This deletes the folder ${removeFolder} and its video files on this device, then removes the catalog record.`
            : removeFolder === null
            ? 'No media folder is linked, so no video files will be touched. This removes the catalog record and its cover.'
            : 'Checking which files this affects…'}
        </Text>
        <Button
          label="Delete"
          danger
          disabled={removeFolder === undefined}
          onPress={() => confirmRemove(removing!)}
        />
      </Sheet>
    </PanelPage>
  );
}
const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    marginBottom: 20,
  },
  hero: {
    fontFamily: displayFamily,
    fontSize: 56,
    fontWeight: '700',
    letterSpacing: -1.5,
    color: colors.text,
  },
  heroPhone: { fontFamily, fontSize: 38, letterSpacing: -0.8 },
  filterHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterGroup: { gap: 10 },
  filterMore: { alignItems: 'flex-start', marginLeft: -2 },
  filterValues: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  active: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
    marginBottom: 20,
  },
  block: { gap: 12, marginBottom: 36 },
  continueRow: { gap: 28 },
  continue: { flexDirection: 'row', width: 300, gap: 14 },
  continueCover: { width: 84 },
  continueCopy: { flex: 1, gap: 6, justifyContent: 'center' },
  continueActions: { flexDirection: 'row', gap: 2, marginLeft: -6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 32 },
  card: { gap: 5 },
  mark: { position: 'absolute', top: 8, right: 8 },
  overlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    flexDirection: 'row',
    gap: 3,
  },
  cardTitle: {
    fontFamily,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.text,
    marginTop: 2,
  },
  cardTitleHover: { fontFamily, color: colors.mist },
  watched: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 34,
    marginTop: 6,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.raised,
  },
  watchedDone: { backgroundColor: 'transparent' },
  watchedHover: { backgroundColor: colors.chrome },
  watchedText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  watchedDoneText: { fontFamily, color: colors.success },
  watchedHoverText: { fontFamily, color: colors.background },
  list: { borderTopWidth: 1, borderColor: colors.line },
  rowLit: { backgroundColor: '#14212E' },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  rowCover: { width: 52 },
  rowCopy: { flex: 1, gap: 3 },
  rowTitle: { fontFamily, fontSize: 15, fontWeight: '600', color: colors.text },
  rowProgress: { maxWidth: 260, marginTop: 3 },
  rowActions: { flexDirection: 'row', gap: 2 },
  hidden: { opacity: 0 },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    marginTop: 40,
  },
  metaGroup: { gap: 2 },
});
