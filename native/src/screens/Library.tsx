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
  SORT_ORDERS,
  Section,
  SortOrder,
  emptyFilter,
} from '../domain/catalog';
import { NewBadge, RatingBadge } from '../components/Badges';
import { useEscape } from '../app/keys';
import {
  newFor,
  refreshNewEpisodes,
  useNewEpisodes,
} from '../services/newEpisodes';
import {
  Button,
  Choice,
  Field,
  ProgressBar,
  Sheet,
  TextButton,
} from '../components/controls';
import { Cover, coverUri } from '../components/Cover';
import { PanelPage, usePageState } from '../components/Fade';
import { PreviewSource, usePreview } from '../platform/usePreview';
import { Icon, IconButton } from '../components/Icon';
import { ActionMenu } from '../components/ActionMenu';
import {
  ContextMenu,
  MenuItem,
  useContextMenu,
} from '../components/ContextMenu';
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

const SORT_LABELS: Record<SortOrder, string> = {
  title: 'Title',
  recentlyWatched: 'Recently watched',
  recentlyAdded: 'Recently added',
  progress: 'Progress',
  rating: 'Your rating',
};
const RATING_FLOORS = [0, 6, 7, 8, 9] as const;

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
        hover && styles.watchedHover,
        done && styles.watchedDone,
        done && hover && styles.watchedDoneHover,
      ]}
    >
      <Icon
        name={done ? 'check' : 'plus'}
        size={14}
        color={done ? colors.success : hover ? colors.accent : colors.muted}
      />
      <Text
        style={[
          styles.watchedText,
          hover && styles.watchedHoverText,
          done && styles.watchedDoneText,
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
  /** Episode files found in the folder beyond the title's episodes. */
  newCount: number;
  /** Selection mode: a press selects instead of opening. */
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
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
  after = () => undefined,
}: CardProps & {
  size: number;
  solid: boolean;
  after?: () => void;
}): React.JSX.Element {
  const then = (run: () => void) => () => {
    run();
    after();
  };
  return (
    <>
      <IconButton
        icon={entry.bookmarked ? 'bookmarkFilled' : 'bookmark'}
        label={entry.bookmarked ? 'Bookmarked' : 'Bookmark'}
        size={size}
        solid={solid}
        onPress={then(onBookmark)}
      />
      {entry.kind === 'anime' ? (
        <IconButton
          icon="queue"
          label={queued ? 'Queued' : 'Add to queue'}
          size={size}
          solid={solid}
          disabled={queued}
          onPress={then(onQueue)}
        />
      ) : (
        <IconButton
          icon="link"
          label="Edit link"
          size={size}
          solid={solid}
          onPress={then(onEdit)}
        />
      )}
      {entry.kind !== 'custom' && (
        <IconButton
          icon="tag"
          label="Metadata"
          size={size}
          solid={solid}
          onPress={then(onMetadata)}
        />
      )}
      <IconButton
        icon="trash"
        label="Delete"
        size={size}
        solid={solid}
        color={colors.danger}
        onPress={then(onDelete)}
      />
    </>
  );
}

/** The same actions as the card's buttons, for its long-press / right-click menu. */
function menuItems(props: CardProps): MenuItem[] {
  const { entry, queued } = props;
  const anime = entry.kind === 'anime';
  const done = anime ? entry.watched : entry.read;
  const items: MenuItem[] = [
    { label: 'Open', icon: anime ? 'player' : 'link', onPress: props.onOpen },
    {
      label: props.selected ? 'Deselect' : 'Select',
      icon: 'select',
      onPress: props.onSelect,
    },
    {
      label: done
        ? anime
          ? 'Mark as unwatched'
          : 'Mark as unread'
        : anime
        ? 'Mark as watched'
        : 'Mark as read',
      icon: 'check',
      onPress: props.onToggleWatched,
    },
    {
      label: entry.bookmarked ? 'Remove bookmark' : 'Bookmark',
      icon: entry.bookmarked ? 'bookmarkFilled' : 'bookmark',
      onPress: props.onBookmark,
    },
  ];
  if (anime) {
    items.push({
      label: queued ? 'Already in queue' : 'Add to queue',
      icon: 'queue',
      onPress: props.onQueue,
      disabled: queued,
    });
  } else {
    items.push({ label: 'Edit link', icon: 'link', onPress: props.onEdit });
  }
  if (entry.kind !== 'custom') {
    items.push({ label: 'Metadata', icon: 'tag', onPress: props.onMetadata });
  }
  items.push({
    label: 'Delete',
    icon: 'trash',
    onPress: props.onDelete,
    danger: true,
  });
  return items;
}

function CardMenu({
  props,
  menu,
}: {
  props: CardProps;
  menu: ReturnType<typeof useContextMenu>;
}): React.JSX.Element {
  return (
    <ContextMenu
      title={props.entry.title}
      visible={menu.visible}
      onClose={menu.close}
      items={menuItems(props)}
    />
  );
}

function subtitle(entry: Entry): string {
  const status = entry.status.replace('_', ' ');
  return entry.season ? `${entry.season}, ${status}` : status;
}

/** The round check shown on each title while selecting. */
function SelectMark({ selected }: { selected: boolean }): React.JSX.Element {
  return (
    <View style={[styles.selectMark, selected && styles.selectMarkOn]}>
      {selected && <Icon name="check" size={14} color={colors.background} />}
    </View>
  );
}

function GridCard(props: CardProps & { width: number }): React.JSX.Element {
  const { entry, uri, width, onToggleWatched, selecting, selected } = props;
  const onOpen = selecting ? props.onSelect : props.onOpen;
  const [hover, setHover] = useState(false);
  // The tray is drawn over the window, so the pointer leaves the card while it is open.
  const [trayOpen, setTrayOpen] = useState(false);
  const menu = useContextMenu();
  const percent = entry.kind === 'anime' ? watchedPercent(entry) : 0;
  // Menu icons track the card width so they stay in proportion as the grid reflows.
  const iconSize = Math.min(20, Math.max(13, Math.round(width / 11)));
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
        accessibilityRole={selecting ? 'checkbox' : 'link'}
        accessibilityState={selecting ? { checked: selected } : undefined}
        accessibilityLabel={
          selecting ? `Select ${entry.title}` : `Open ${entry.title}`
        }
        accessibilityHint="Long-press or right-click for more actions"
        onPress={onOpen}
        {...menu.pressProps}
      >
        <Cover uri={uri} title={entry.title} dim={selecting && !selected}>
          {selecting && (
            <View style={styles.selectSpot}>
              <SelectMark selected={selected} />
            </View>
          )}
          {selected && <View style={styles.selectedFrame} />}
          {entry.bookmarked && !hover && !trayOpen && !selecting && (
            <View style={styles.mark}>
              <Icon name="bookmarkFilled" size={16} color={colors.chrome} />
            </View>
          )}
          {(entry.rating || props.newCount > 0) && (
            <View style={styles.coverFoot}>
              <RatingBadge rating={entry.rating} overlay />
              <View style={ui.grow} />
              <NewBadge count={props.newCount} overlay />
            </View>
          )}
          {(hover || trayOpen || !HOVER) && !selecting && (
            <View style={styles.overlay}>
              <ActionMenu
                size={iconSize}
                solid
                label={`Actions for ${entry.title}`}
                tray
                onOpenChange={setTrayOpen}
                items={menuItems(props).filter(
                  item => item.label !== 'Open' && item.icon !== 'select',
                )}
              />
            </View>
          )}
        </Cover>
      </Pressable>
      <Pressable
        {...noFocusRing}
        accessibilityRole="link"
        accessibilityLabel={entry.title}
        onPress={onOpen}
        {...menu.pressProps}
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
      {/* Cards in a row share its height, so the buttons line up across the row. */}
      <View style={styles.cardFoot}>
        <WatchedButton entry={entry} onPress={onToggleWatched} />
      </View>
      <CardMenu props={props} menu={menu} />
    </Pressable>
  );
}

function ListRow(props: CardProps & { phone: boolean }): React.JSX.Element {
  const { entry, uri, phone, onToggleWatched, selecting, selected } = props;
  const onOpen = selecting ? props.onSelect : props.onOpen;
  const [hover, setHover] = useState(false);
  const menu = useContextMenu();
  const percent = entry.kind === 'anime' ? watchedPercent(entry) : 0;
  return (
    <Pressable
      {...noFocusRing}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      focusable={false}
      style={[styles.rowItem, (hover || selected) && styles.rowLit]}
    >
      {selecting && (
        <Pressable
          {...noFocusRing}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={`Select ${entry.title}`}
          onPress={props.onSelect}
        >
          <SelectMark selected={selected} />
        </Pressable>
      )}
      <Pressable
        {...noFocusRing}
        accessibilityRole="link"
        accessibilityLabel={`Open ${entry.title}`}
        onPress={onOpen}
        style={styles.rowCover}
        {...menu.pressProps}
      >
        <Cover uri={uri} title={entry.title} />
      </Pressable>
      <View style={styles.rowCopy}>
        <Pressable
          {...noFocusRing}
          accessibilityRole="link"
          accessibilityLabel={entry.title}
          onPress={onOpen}
          {...menu.pressProps}
        >
          <Text
            numberOfLines={1}
            style={[styles.rowTitle, hover && styles.cardTitleHover]}
          >
            {entry.title}
          </Text>
        </Pressable>
        <View style={styles.rowMeta}>
          <Text numberOfLines={1} style={[ui.small, styles.rowMetaText]}>
            {subtitle(entry)}
            {entry.kind === 'anime' ? `, ${Math.round(percent)}% watched` : ''}
          </Text>
          <RatingBadge rating={entry.rating} />
          <NewBadge count={props.newCount} />
        </View>
        {percent > 0 && percent < 100 && (
          <View style={styles.rowProgress}>
            <ProgressBar value={percent} label={`${entry.title} completion`} />
          </View>
        )}
      </View>
      {!phone && !selecting && (
        <View style={[styles.rowActions, !hover && styles.hidden]}>
          <Actions {...props} size={16} solid={false} />
        </View>
      )}
      <WatchedButton entry={entry} onPress={onToggleWatched} />
      <CardMenu props={props} menu={menu} />
    </Pressable>
  );
}

function ContinueItem({
  title,
  uri,
  detail,
  percent,
  onContinue,
  onOpen,
  onRestart,
  onDiscard,
  workspace,
  preview,
}: {
  workspace: Workspace;
  preview: PreviewSource;
  title: string;
  uri: string | null;
  detail: string;
  percent: number;
  onContinue: () => void;
  onOpen: () => void;
  onRestart: () => void;
  onDiscard: () => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const clip = usePreview(workspace, preview);
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
        <Text
          numberOfLines={2}
          accessibilityRole="link"
          accessibilityHint="Opens the anime details"
          onPress={onOpen}
          style={styles.rowTitle}
        >
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
  // Kept through a window resize, which re-renders this page from scratch.
  const [metadata, setMetadata] = usePageState<Entry | null>('metadata', null);
  const [editing, setEditing] = usePageState<Entry | null>('editing', null);
  const [removing, setRemoving] = usePageState<Entry | null>('removing', null);
  const [removeFolder, setRemoveFolder] = usePageState<
    string | null | undefined
  >('removeFolder', undefined);
  const [link, setLink] = usePageState('link', '');
  const [expandedGroups, setExpandedGroups] = usePageState<string[]>(
    'expandedGroups',
    [],
  );
  // Selecting several titles at once; Esc or Done leaves it.
  const [selection, setSelection] = usePageState<string[] | null>(
    'selection',
    null,
  );
  const [bulkDelete, setBulkDelete] = usePageState<
    { id: string; title: string; folder: string | null }[] | null
  >('bulkDelete', null);
  useEscape(selection !== null && bulkDelete === null, () =>
    setSelection(null),
  );
  const { scan, scanning } = useNewEpisodes();
  const workspace = useRef(w);
  workspace.current = w;
  const scroller = useRef<ScrollView>(null);
  const listTop = useRef<View>(null);
  // A new page starts at its first title, as the old app scrolled to the list.
  const goToPage = (value: number) => {
    update({ page: value });
    setTimeout(() => {
      listTop.current?.measureInWindow((_x, y) => {
        const bar = phone ? 40 : 100;
        if (y < bar) {
          scroller.current?.scrollTo({
            y: Math.max(0, (scrollPositions.get(sectionId) ?? 0) + y - bar),
            animated: true,
          });
        }
      });
    }, 30);
  };
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
  const fresh = useMemo(
    () =>
      new Set(entries.filter(e => newFor(scan, e.id).length).map(e => e.id)),
    [entries, scan],
  );
  const found = useMemo(
    () =>
      filterEntries(entries, deferred, {
        progress: w.catalog!.progress,
        fresh,
      }),
    [entries, deferred, fresh, w.catalog],
  );
  const catalog = useMemo(() => metadataCatalog(entries), [entries]);
  const activeTags = METADATA_GROUPS.flatMap(group =>
    filter.metadata[group].map(value => ({ group, value })),
  );
  const activeCount =
    activeTags.length +
    (filter.unread ? 1 : 0) +
    (filter.ongoing ? 1 : 0) +
    (filter.bookmarked ? 1 : 0) +
    (filter.fresh ? 1 : 0) +
    (filter.minRating ? 1 : 0);
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
    newCount: newFor(scan, entry.id).length,
    selecting: selection !== null,
    selected: !!selection?.includes(entry.id),
    onSelect: () =>
      setSelection(list =>
        !list
          ? [entry.id]
          : list.includes(entry.id)
          ? list.filter(id => id !== entry.id)
          : [...list, entry.id],
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
  const checkFolders = () =>
    w
      .run(async () => {
        const count = await refreshNewEpisodes(w.io!, w.catalog!, w.settings);
        return count
          ? `New episode files found for ${count} title${
              count === 1 ? '' : 's'
            }`
          : 'No new episode files found';
      })
      .catch(w.setError);
  const chosen = entries.filter(e => selection?.includes(e.id));
  const anime = section.kind === 'anime';
  const bulk = (
    task: (c: Parameters<Parameters<typeof w.mutate>[0]>[0]) => void,
    message: string,
  ) => {
    action(async () => {
      await w.mutate(task);
      setSelection(null);
    }, message);
  };
  const askBulkDelete = () => {
    action(async () => {
      const targets = await Promise.all(
        chosen.map(async e => ({
          id: e.id,
          title: e.title,
          folder:
            (await resolvedDeleteTarget(e, w.settings, w.io!))?.relativePath ??
            null,
        })),
      );
      setBulkDelete(targets);
    });
  };
  const confirmBulkDelete = () => {
    const targets = bulkDelete ?? [];
    setBulkDelete(null);
    action(async () => {
      for (const target of targets) {
        const entry = w.catalog!.entries.find(e => e.id === target.id);
        if (entry) {
          await deleteEntry(entry, w.settings, w.io!, w.mutate);
        }
      }
      setSelection(null);
    }, `Deleted ${targets.length} title${targets.length === 1 ? '' : 's'}`);
  };
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
    <View style={ui.grow}>
      <PanelPage
        scrollRef={scroller}
        onScrollY={y => scrollPositions.set(sectionId, y)}
        onRefresh={section.kind === 'anime' ? checkFolders : undefined}
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
            <View style={styles.countRow}>
              <Text style={ui.muted}>
                {visible.length
                  ? `Showing ${(page - 1) * perPage + 1}-${
                      (page - 1) * perPage + visible.length
                    } of ${found.length}`
                  : '0 titles'}
              </Text>
              <Choice
                inline
                row
                label="Sort by"
                values={SORT_ORDERS.map(o => SORT_LABELS[o])}
                value={SORT_LABELS[filter.sort]}
                onChange={label =>
                  update({
                    sort: (SORT_ORDERS.find(o => SORT_LABELS[o] === label) ??
                      'title') as SortOrder,
                  })
                }
              />
            </View>
          </View>
          {section.kind === 'anime' && (
            <IconButton
              icon="refresh"
              label={
                scanning
                  ? 'Checking folders for new episodes'
                  : 'Check folders for new episodes'
              }
              active={scanning}
              disabled={scanning || !w.io}
              onPress={() => checkFolders()}
            />
          )}
          <IconButton
            icon="select"
            label={selection ? 'Stop selecting' : 'Select titles'}
            active={selection !== null}
            onPress={() => setSelection(selection ? null : [])}
          />
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
              {anime && (
                <TextToggle
                  label={`New episodes ${fresh.size}`}
                  active={filter.fresh}
                  onPress={() => update({ fresh: !filter.fresh })}
                />
              )}
            </View>
          </View>
          <View style={styles.filterGroup}>
            <View style={ui.rule} />
            <Text style={ui.subheading}>Your rating</Text>
            <View style={styles.filterValues}>
              {RATING_FLOORS.map(floor => (
                <TextToggle
                  key={floor}
                  label={floor ? `${floor} and up` : 'Any'}
                  active={filter.minRating === floor}
                  onPress={() => update({ minRating: floor })}
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
                        label={
                          expanded ? 'Show fewer' : `Show all ${all.length}`
                        }
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
            {filter.fresh && (
              <TextToggle
                label="New episodes ×"
                active
                onPress={() => update({ fresh: false })}
              />
            )}
            {filter.minRating > 0 && (
              <TextToggle
                label={`Rated ${filter.minRating} and up ×`}
                active
                onPress={() => update({ minRating: 0 })}
              />
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
            {/* Windows draws a scrollbar across the covers regardless of the prop;
              it sits in a strip the wrapper clips off. */}
            <View style={styles.continueClip}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.continueScroll}
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
                      workspace={w}
                      preview={{
                        entryId: entry.id,
                        episodeId: episode.id,
                        start: progress.currentTime,
                      }}
                      title={entry.title}
                      uri={
                        entry.cover ? coverUri(entry, w.io?.privateRoot) : null
                      }
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
                      onOpen={() =>
                        navigate({ name: 'details', animeId: entry.id })
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
          </View>
        )}
        <View ref={listTop} collapsable={false} />
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
              <GridCard
                key={entry.id}
                {...cardProps(entry)}
                width={cardWidth}
              />
            ))}
          </View>
        )}
        {visible.length > 0 && (
          <View style={styles.footer}>
            <IconButton
              icon="back"
              label="Previous"
              disabled={page <= 1}
              onPress={() => goToPage(page - 1)}
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
                onPress={() => goToPage(value)}
              />
            ))}
            <IconButton
              icon="forward"
              label="Next"
              disabled={page >= totalPages}
              onPress={() => goToPage(page + 1)}
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
              onPress={() =>
                scroller.current?.scrollTo({ y: 0, animated: true })
              }
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
        <Sheet
          title={`Delete ${bulkDelete?.length ?? 0} titles?`}
          visible={bulkDelete !== null}
          onClose={() => setBulkDelete(null)}
        >
          <Text style={ui.text}>
            {bulkDelete?.some(t => t.folder)
              ? 'These titles have a media folder on this device. Deleting removes each folder and its video files, then the catalog records:'
              : 'No media folders are linked, so no video files will be touched. This removes the catalog records and their covers.'}
          </Text>
          {bulkDelete
            ?.filter(t => t.folder)
            .map(t => (
              <Text key={t.id} style={ui.small}>
                {t.folder}
              </Text>
            ))}
          <Button
            label={`Delete ${bulkDelete?.length ?? 0} titles`}
            danger
            onPress={confirmBulkDelete}
          />
        </Sheet>
      </PanelPage>
      {selection !== null && (
        <View
          accessibilityRole="toolbar"
          style={[styles.selectBar, phone && styles.selectBarPhone]}
        >
          <Text style={styles.selectCount}>
            {selection.length
              ? `${selection.length} selected`
              : 'Select titles'}
          </Text>
          <TextToggle
            label={
              visible.every(e => selection.includes(e.id))
                ? 'Clear page'
                : 'Select page'
            }
            active={false}
            onPress={() =>
              setSelection(list => {
                const ids = visible.map(e => e.id);
                const all = ids.every(id => list?.includes(id));
                return all
                  ? (list ?? []).filter(id => !ids.includes(id))
                  : [...new Set([...(list ?? []), ...ids])];
              })
            }
          />
          <View style={ui.grow} />
          <IconButton
            icon="check"
            label={anime ? 'Mark as watched' : 'Mark as read'}
            disabled={!chosen.length}
            onPress={() =>
              bulk(
                c => {
                  for (const e of chosen) {
                    if (e.kind === 'anime') {
                      setWatched(c, e.id, true);
                    } else {
                      entryById(c, e.id).read = true;
                    }
                  }
                },
                anime ? 'Marked as watched' : 'Marked as read',
              )
            }
          />
          <IconButton
            icon="reset"
            label={anime ? 'Mark as unwatched' : 'Mark as unread'}
            disabled={!chosen.length}
            onPress={() =>
              bulk(
                c => {
                  for (const e of chosen) {
                    if (e.kind === 'anime') {
                      setWatched(c, e.id, false);
                    } else {
                      entryById(c, e.id).read = false;
                    }
                  }
                },
                anime ? 'Marked as unwatched' : 'Marked as unread',
              )
            }
          />
          {anime && (
            <IconButton
              icon="queue"
              label="Add to queue"
              disabled={!chosen.length}
              onPress={() =>
                bulk(c => {
                  for (const e of chosen) {
                    if (!c.queue.includes(e.id)) {
                      c.queue.push(e.id);
                    }
                  }
                }, 'Added to queue')
              }
            />
          )}
          <IconButton
            icon="bookmark"
            label="Bookmark"
            disabled={!chosen.length}
            onPress={() =>
              bulk(c => {
                for (const e of chosen) {
                  entryById(c, e.id).bookmarked = true;
                }
              }, 'Bookmarked')
            }
          />
          <IconButton
            icon="trash"
            label="Delete"
            color={colors.danger}
            disabled={!chosen.length}
            onPress={askBulkDelete}
          />
          <IconButton
            icon="close"
            label="Stop selecting"
            onPress={() => setSelection(null)}
          />
        </View>
      )}
    </View>
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
  continueClip: { overflow: 'hidden' },
  continueScroll: { marginBottom: -16 },
  continueRow: { gap: 28, paddingBottom: 16 },
  continue: { flexDirection: 'row', width: 300, gap: 14 },
  continueCover: { width: 84 },
  continueCopy: { flex: 1, gap: 6, justifyContent: 'center' },
  continueActions: { flexDirection: 'row', gap: 2, marginLeft: -6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 32 },
  card: { gap: 5 },
  cardFoot: { flexGrow: 1, justifyContent: 'flex-end' },
  mark: { position: 'absolute', top: 8, right: 8 },
  coverFoot: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectSpot: { position: 'absolute', top: 8, left: 8 },
  selectedFrame: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: 6,
  },
  selectMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.chrome,
    backgroundColor: '#0A131DB3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectMarkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  selectBar: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#0A131DF2',
  },
  selectBarPhone: { left: 12, right: 12, bottom: 12, borderRadius: 18 },
  selectCount: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.mist,
    marginRight: 6,
  },
  countRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 16,
  },
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
  // Neutral until done, then green; hover outlines it in the state's colour.
  watched: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 34,
    marginTop: 6,
    borderRadius: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.raised,
  },
  watchedHover: { backgroundColor: colors.hover, borderColor: colors.accent },
  watchedDone: {
    backgroundColor: colors.successSoft,
    borderColor: colors.successLine,
  },
  watchedDoneHover: { backgroundColor: '#22402F', borderColor: colors.success },
  watchedText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  watchedHoverText: { fontFamily, color: colors.mist },
  watchedDoneText: { fontFamily, color: colors.success },
  list: { borderTopWidth: 1, borderColor: colors.line },
  rowLit: { backgroundColor: colors.rowHover },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  rowCover: { width: 52 },
  rowCopy: { flex: 1, gap: 3 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowMetaText: { flexShrink: 1 },
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
