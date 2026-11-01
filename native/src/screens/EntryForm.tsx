import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import {
  Button,
  Choice,
  Field,
  HoverRow,
  Sheet,
  TextButton,
} from '../components/controls';
import { Cover, coverUri } from '../components/Cover';
import { PanelPage } from '../components/Fade';
import { Icon, IconButton } from '../components/Icon';
import { colors, ui, noFocusRing } from '../design/theme';
import { useViewport } from '../design/viewport';
import { scanRelations } from '../services/relations';
import { Entry, METADATA_GROUPS, emptyMetadata } from '../domain/catalog';
import { animeFolder, createEntryMediaFolder } from '../services/mediaFolders';
import {
  EntryDraft,
  cleanTitle,
  createEntry,
  metadataCatalog,
} from '../services/library';
import { importCover } from '../services/media';
import { jikan, mapJikan, SearchResult } from '../integrations/JikanClient';

export function EntryForm({
  workspace: w,
  sectionId,
  navigate,
}: {
  workspace: Workspace;
  sectionId: string;
  navigate: (route: Route) => void;
}): React.JSX.Element {
  const { width } = useViewport();
  const section = w.catalog!.sections.find(s => s.id === sectionId)!;
  const [draft, setDraft] = useState<EntryDraft>({
    title: '',
    season: 'S1',
    status: 'Ongoing',
    link: '',
    episodeCount: 12,
    metadata: emptyMetadata(),
    cover: null,
    external: null,
  });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [lookup, setLookup] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedTitle, setSelectedTitle] = useState('');
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  const [remoteCover, setRemoteCover] = useState('');
  const request = useRef<AbortController | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspace = useRef(w);
  workspace.current = w;
  const catalog = useMemo(
    () =>
      metadataCatalog(
        w.catalog!.entries.filter(e => e.sectionId === sectionId),
      ),
    [w.catalog, sectionId],
  );
  function update<K extends keyof EntryDraft>(
    key: K,
    value: EntryDraft[K],
  ): void {
    setDraft(d => ({ ...d, [key]: value }));
  }
  const search = useCallback(async () => {
    if (searchTimer.current !== null) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    request.current?.abort();
    if (query.trim().length < 2 || section.kind === 'custom') {
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setLookup(true);
    setSearched(false);
    try {
      const items = await jikan.search(
        section.kind === 'anime' ? 'anime' : 'manga',
        query,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setResults(items);
        setSearched(true);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        workspace.current.setError(String(error));
      }
    } finally {
      if (request.current === controller) {
        setLookup(false);
      }
    }
  }, [query, section.kind]);
  useEffect(() => {
    request.current?.abort();
    setLookup(false);
    setResults([]);
    setSearched(false);
    if (section.kind !== 'custom' && query.trim().length >= 2) {
      searchTimer.current = setTimeout(() => {
        search().catch(workspace.current.setError);
      }, 500);
    }
    return () => {
      if (searchTimer.current !== null) {
        clearTimeout(searchTimer.current);
        searchTimer.current = null;
      }
      request.current?.abort();
    };
  }, [query, search, section.kind]);
  const select = async (result: SearchResult) => {
    if (searchTimer.current !== null) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLookup(true);
    try {
      const item = await jikan.detail(
        section.kind === 'anime' ? 'anime' : 'manga',
        result.mal_id,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setDraft(d => ({
          ...d,
          ...mapJikan(item, section.kind === 'anime' ? 'anime' : 'manga'),
        }));
        setRemoteCover(
          item.images?.webp?.image_url ?? item.images?.jpg?.image_url ?? '',
        );
        setResults([]);
        setSearched(false);
        setSelectedTitle(item.title);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        w.setError(String(error));
      }
    } finally {
      if (request.current === controller) {
        setLookup(false);
      }
    }
  };
  const save = () =>
    w.run(
      async () => {
        if (!w.io) {
          throw new Error('Storage is not ready');
        }
        let cover = draft.cover;
        if (!cover && remoteCover) {
          try {
            const url = new URL(remoteCover);
            if (
              url.protocol !== 'https:' ||
              !['cdn.myanimelist.net', 'myanimelist.net'].includes(url.hostname)
            ) {
              throw new Error('Untrusted cover URL');
            }
            const downloadController = new AbortController();
            const timeout = setTimeout(() => downloadController.abort(), 8000);
            let response: Response;
            try {
              response = await fetch(remoteCover, {
                signal: downloadController.signal,
              });
            } finally {
              clearTimeout(timeout);
            }
            if (!response.ok) {
              throw new Error('Cover download unavailable');
            }
            const data = new Uint8Array(await response.arrayBuffer());
            if (data.length > 8 * 1024 * 1024) {
              throw new Error('Cover too large');
            }
            const source = `${
              w.io.privateRoot
            }/downloads/cover-${Date.now()}.image`;
            await w.io.writeBytes(source, data);
            try {
              cover = await importCover(w.io, source);
            } finally {
              await w.io.removeOwned(source);
            }
          } catch (error) {
            w.setError(`Title saved without online cover: ${String(error)}`);
          }
        }
        let added: Entry | undefined;
        await w.mutate(c => {
          const created = createEntry(c, sectionId, { ...draft, cover });
          if (created.kind === 'anime') {
            created.relativeFolder = animeFolder(created);
            scanRelations(c, created.id);
          }
          added = created;
        });
        if (added?.kind === 'anime') {
          try {
            await createEntryMediaFolder(added, w.settings, w.io!);
          } catch (error) {
            w.setError(
              `Entry saved. Media folder creation failed: ${String(
                error,
              )}. Retry from Settings.`,
            );
          }
        }
        navigate({ name: 'library', sectionId });
      },
      section.kind === 'anime' && !w.settings.roots[sectionId]
        ? 'Entry added. No media folder is selected; choose one in Settings to create folders.'
        : `${section.title} entry added`,
    );
  const [confirmation, setConfirmation] = useState<{
    title: string;
    message: string;
    buttons: { text: string; style?: string; onPress?: () => void }[];
  } | null>(null);
  const confirm = (
    title: string,
    message: string,
    buttons: NonNullable<typeof confirmation>['buttons'],
  ) => setConfirmation({ title, message, buttons });
  const confirmSave = () => {
    const extras = METADATA_GROUPS.flatMap(g =>
      draft.metadata[g].filter(
        v =>
          !catalog[g].some(
            existing => existing.name.toLowerCase() === v.toLowerCase(),
          ),
      ),
    );
    if (extras.length) {
      confirm('Add new metadata values?', extras.join(', '), [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add entry',
          onPress: () => {
            save().catch(w.setError);
          },
        },
      ]);
    } else {
      save().catch(w.setError);
    }
  };
  const titleFeedback = useMemo(() => {
    try {
      cleanTitle(draft.title);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [draft.title]);
  const compare = (value: string) => value.trim().toLowerCase();
  const duplicate = w.catalog!.entries.some(
    e =>
      (e.sectionId === sectionId &&
        compare(e.title) === compare(draft.title) &&
        (section.kind === 'manga' ||
          (section.kind === 'anime' &&
            compare(e.season) === compare(draft.season) &&
            e.status === draft.status) ||
          (section.kind === 'custom' &&
            e.status === draft.status &&
            compare(e.link) === compare(draft.link)))) ||
      (draft.external !== null &&
        e.kind === section.kind &&
        e.external?.malId === draft.external.malId),
  );
  return (
    <PanelPage width={950}>
      <View style={[formStyles.column, width < 700 && formStyles.phone]}>
        <Text accessibilityRole="header" style={ui.heading}>
          Add {section.title}
        </Text>
        {section.kind !== 'custom' && (
          <View style={formStyles.group}>
            <Text style={ui.subheading}>Find metadata</Text>
            <View style={formStyles.search}>
              <View style={ui.grow}>
                <Field label="Search Jikan" value={query} onChange={setQuery} />
              </View>
              <IconButton
                icon="search"
                label={lookup ? 'Searching…' : 'Search'}
                disabled={lookup || query.trim().length < 2}
                onPress={() => {
                  search().catch(w.setError);
                }}
              />
            </View>
            {results.map(item => (
              <View key={item.mal_id}>
                <View style={ui.rule} />
                <HoverRow
                  label={`${item.title} (${item.type})`}
                  onPress={() => {
                    select(item).catch(w.setError);
                  }}
                  style={[
                    formStyles.result,
                    draft.external?.malId === item.mal_id &&
                      formStyles.selected,
                  ]}
                >
                  <View style={formStyles.resultCover}>
                    <Cover
                      title={item.title}
                      uri={
                        item.images?.webp?.image_url ??
                        item.images?.jpg?.image_url ??
                        null
                      }
                    />
                  </View>
                  <View style={ui.grow}>
                    <Text
                      style={[
                        ui.text,
                        draft.external?.malId === item.mal_id &&
                          formStyles.selectedText,
                      ]}
                    >
                      {item.title}
                    </Text>
                    <Text style={ui.small}>
                      {[
                        item.type,
                        item.status,
                        item.episodes != null
                          ? `${item.episodes} episodes`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </Text>
                  </View>
                  <Icon name="forward" color={colors.muted} />
                </HoverRow>
              </View>
            ))}
            {searched && !lookup && results.length === 0 && (
              <Text accessibilityLiveRegion="polite" style={ui.small}>
                No results
              </Text>
            )}
            {selectedTitle !== '' && (
              <Text
                accessibilityLiveRegion="polite"
                style={[ui.small, formStyles.selectedText, formStyles.selected]}
              >
                Selected: {selectedTitle}
              </Text>
            )}
            <Text style={ui.small}>Optional. Manual entry works offline.</Text>
          </View>
        )}
        <Text style={ui.subheading}>Entry details</Text>
        <Field
          label="Title"
          value={draft.title}
          onChange={v => update('title', v)}
        />
        {titleFeedback !== '' && (
          <Text accessibilityLiveRegion="polite" style={ui.small}>
            {titleFeedback}
          </Text>
        )}
        {duplicate && (
          <Text accessibilityLiveRegion="polite" style={ui.small}>
            This entry already exists.
          </Text>
        )}
        {section.kind === 'anime' && (
          <>
            <Field
              label="Season"
              value={draft.season}
              onChange={v => update('season', v)}
            />
            <Field
              label="Episode count"
              value={String(draft.episodeCount)}
              numeric
              onChange={v => update('episodeCount', Number(v))}
            />
          </>
        )}
        <View style={ui.row}>
          <Choice
            label="Release status"
            values={
              section.kind === 'anime'
                ? ['Ongoing', 'Completed', 'Not_Aired']
                : ['Ongoing', 'Completed', 'Hiatus']
            }
            value={draft.status}
            onChange={v => update('status', v as EntryDraft['status'])}
          />
        </View>
        <Field
          label="Source / reading link"
          value={draft.link}
          onChange={v => update('link', v)}
          placeholder="https://…"
        />
        {section.kind !== 'custom' &&
          METADATA_GROUPS.map(group => (
            <View key={group} style={formStyles.group}>
              <Text style={ui.subheading}>
                {group.charAt(0).toUpperCase() + group.slice(1)}
              </Text>
              <View style={ui.row}>
                {[
                  ...new Set([
                    ...catalog[group].map(v => v.name),
                    ...draft.metadata[group],
                  ]),
                ].map(value => (
                  <FormAction
                    key={value}
                    accessibilityRole="button"
                    accessibilityLabel={value}
                    accessibilityState={{
                      selected: draft.metadata[group].includes(value),
                    }}
                    style={[
                      formStyles.option,
                      draft.metadata[group].includes(value) &&
                        formStyles.selected,
                    ]}
                    onPress={() =>
                      update('metadata', {
                        ...draft.metadata,
                        [group]: draft.metadata[group].includes(value)
                          ? draft.metadata[group].filter(v => v !== value)
                          : [...draft.metadata[group], value],
                      })
                    }
                  >
                    <Icon
                      name={
                        draft.metadata[group].includes(value) ? 'check' : 'plus'
                      }
                      size={16}
                      color={
                        draft.metadata[group].includes(value)
                          ? colors.accent
                          : colors.muted
                      }
                    />
                    <Text
                      style={
                        draft.metadata[group].includes(value)
                          ? [ui.text, formStyles.selectedText]
                          : ui.muted
                      }
                    >
                      {value}
                    </Text>
                  </FormAction>
                ))}
              </View>
              <Field
                label={`New ${group} value`}
                value={newValues[group] ?? ''}
                onChange={value =>
                  setNewValues(s => ({ ...s, [group]: value }))
                }
              />
              <IconButton
                icon="plus"
                label="Add value"
                onPress={() => {
                  const value = (newValues[group] ?? '')
                    .trim()
                    .replace(/\s+/g, ' ');
                  if (!value) {
                    return;
                  }
                  const existing =
                    METADATA_GROUPS.find(g =>
                      catalog[g].some(
                        v => v.name.toLowerCase() === value.toLowerCase(),
                      ),
                    ) ?? group;
                  update('metadata', {
                    ...draft.metadata,
                    [existing]: [
                      ...new Set([...draft.metadata[existing], value]),
                    ],
                  });
                  setNewValues(s => ({ ...s, [group]: '' }));
                }}
              />
            </View>
          ))}
        <Text style={ui.subheading}>Artwork</Text>
        <IconButton
          icon="folder"
          label="Choose cover"
          onPress={() => {
            w.run(async () => {
              const selected = (await w.io!.pickFiles('image'))[0];
              if (selected) {
                update('cover', await importCover(w.io!, selected));
              }
            }, 'Cover selected').catch(w.setError);
          }}
        />
        {draft.cover && (
          <View style={formStyles.cover}>
            <Cover
              title={draft.title || 'New entry'}
              uri={coverUri({ cover: draft.cover }, w.io?.privateRoot)}
            />
          </View>
        )}
        <View style={ui.rule} />
        <Button
          label={`Add ${section.title}`}
          primary
          disabled={w.busy}
          onPress={confirmSave}
        />

        <Sheet
          title={confirmation?.title ?? ''}
          visible={confirmation !== null}
          onClose={() => setConfirmation(null)}
        >
          <Text style={ui.text}>{confirmation?.message}</Text>
          <View style={ui.row}>
            {confirmation?.buttons.map(button => (
              <TextButton
                key={button.text}
                label={button.text}
                onPress={() => {
                  setConfirmation(null);
                  button.onPress?.();
                }}
              />
            ))}
          </View>
        </Sheet>
      </View>
    </PanelPage>
  );
}
const formStyles = StyleSheet.create({
  column: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: 24 },
  phone: { gap: 20 },
  search: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  group: { gap: 16, paddingVertical: 12 },
  cover: { width: 160 },
  resultCover: { width: 48 },
  selectedText: { color: colors.accent },
  selected: { backgroundColor: colors.accentSoft },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingRight: 16,
  },
});

function FormAction({
  style,
  ...props
}: React.ComponentProps<typeof Pressable>): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  return (
    <Pressable
      {...noFocusRing}
      {...props}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={state => [
        typeof style === 'function' ? style(state) : style,
        (hover || focus || state.pressed) && { backgroundColor: colors.hover },
      ]}
    />
  );
}
