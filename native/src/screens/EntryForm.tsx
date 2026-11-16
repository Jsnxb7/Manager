import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import {
  Button,
  Choice,
  Field,
  HoverRow,
  TextButton,
} from '../components/controls';
import { Cover, coverUri } from '../components/Cover';
import { PanelPage } from '../components/Fade';
import { Icon, IconButton } from '../components/Icon';
import { colors, fontFamily, ui, noFocusRing } from '../design/theme';
import { Reveal } from '../components/Motion';
import { Stepper } from '../components/Stepper';
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
import { pushKeyHandler, useEscape } from '../app/keys';
import { windowAction } from '../platform/windowControls';
import {
  IMAGE_EXTENSIONS,
  canDropFiles,
  hasExtension,
  useFileDrops,
} from '../platform/drops';
import {
  jikan,
  mapJikan,
  otherTitles,
  SearchResult,
  startYear,
} from '../integrations/JikanClient';

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
  // The result picked by arrow keys; Enter takes it, Esc closes the list.
  const [highlight, setHighlight] = useState(-1);
  useEffect(() => setHighlight(-1), [results]);
  const [searchFocused, setSearchFocused] = useState(false);
  // Windows sends Up/Down here (not to the page scroll) while the list is in use.
  const arrowsActive = searchFocused && results.length > 0;
  useEffect(() => {
    if (Platform.OS !== 'windows' || !arrowsActive) {
      return;
    }
    windowAction('arrowsOn').catch(() => undefined);
    const stop = pushKeyHandler(key => {
      if (key !== 'ArrowUp' && key !== 'ArrowDown') {
        return false;
      }
      onSearchKeyRef.current(key);
      return true;
    });
    return () => {
      stop();
      windowAction('arrowsOff').catch(() => undefined);
    };
  }, [arrowsActive]);
  useEscape(results.length > 0, () => setResults([]));
  const onSearchKeyRef = useRef((_key: string) => undefined as void);
  const onSearchKey = (key: string) => {
    if (!results.length) {
      return;
    }
    if (key === 'ArrowDown') {
      setHighlight(i => (i + 1) % results.length);
    } else if (key === 'ArrowUp') {
      setHighlight(i => (i <= 0 ? results.length - 1 : i - 1));
    }
  };
  onSearchKeyRef.current = onSearchKey;
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
  // An image dragged onto the window becomes the cover.
  useFileDrops(paths => {
    const image = paths.find(path => hasExtension(path, IMAGE_EXTENSIONS));
    if (!image) {
      w.setError('Drop an image file to use it as the cover.');
      return;
    }
    w.run(async () => {
      update('cover', await importCover(w.io!, image));
    }, 'Cover selected').catch(w.setError);
  });
  const addValue = (group: (typeof METADATA_GROUPS)[number]): void => {
    const value = (newValues[group] ?? '').trim().replace(/\s+/g, ' ');
    if (!value) {
      return;
    }
    const existing =
      METADATA_GROUPS.find(g =>
        catalog[g].some(v => v.name.toLowerCase() === value.toLowerCase()),
      ) ?? group;
    update('metadata', {
      ...draft.metadata,
      [existing]: [...new Set([...draft.metadata[existing], value])],
    });
    setNewValues(s => ({ ...s, [group]: '' }));
  };
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
  const steps = useMemo(
    () =>
      (section.kind === 'custom'
        ? ['details', 'artwork', 'review']
        : ['find', 'details', 'metadata', 'artwork', 'review']) as StepKey[],
    [section.kind],
  );
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(0);
  const scroller = useRef<ScrollView | null>(null);
  const stepKey = steps[step]!;
  const detailsAt = steps.indexOf('details');
  const detailsValid =
    draft.title.trim() !== '' && titleFeedback === '' && !duplicate;
  const reachable = detailsValid ? steps.length - 1 : detailsAt;
  const go = (index: number) => {
    const next = Math.max(0, Math.min(index, reachable, steps.length - 1));
    if (next === step) {
      return;
    }
    setDirection(next > step ? 1 : -1);
    setStep(next);
    scroller.current?.scrollTo({ y: 0, animated: true });
  };
  const goRef = useRef(go);
  goRef.current = go;
  // Picking a search result fills the details, so the form moves on to them.
  const pickedRef = useRef(selectedTitle);
  useEffect(() => {
    if (selectedTitle && selectedTitle !== pickedRef.current) {
      goRef.current(steps.indexOf('details'));
    }
    pickedRef.current = selectedTitle;
  }, [selectedTitle, steps]);
  const addedValues = METADATA_GROUPS.flatMap(g =>
    draft.metadata[g].filter(
      v =>
        !catalog[g].some(
          existing => existing.name.toLowerCase() === v.toLowerCase(),
        ),
    ),
  );
  const coverSource = draft.cover
    ? coverUri({ cover: draft.cover }, w.io?.privateRoot)
    : remoteCover || null;
  const chooseCover = () => {
    w.run(async () => {
      const picked = (await w.io!.pickFiles('image'))[0];
      if (picked) {
        update('cover', await importCover(w.io!, picked));
      }
    }, 'Cover selected').catch(w.setError);
  };
  const wide = width >= 1000;
  const phone = width < 700;
  const metadataCount = METADATA_GROUPS.reduce(
    (sum, g) => sum + draft.metadata[g].length,
    0,
  );
  const overview = (
    <Overview
      title={draft.title}
      cover={coverSource}
      lines={[
        section.kind === 'anime'
          ? [draft.season, `${draft.episodeCount || 0} episodes`]
              .filter(Boolean)
              .join(' · ')
          : '',
        draft.status.replace('_', ' '),
        section.kind !== 'custom'
          ? metadataCount
            ? `${metadataCount} metadata values`
            : 'No metadata yet'
          : '',
        draft.external ? `MyAnimeList #${draft.external.malId}` : '',
      ].filter(Boolean)}
      compact={!wide}
    />
  );
  const content = (() => {
    switch (stepKey) {
      case 'find':
        return (
          <View style={formStyles.group}>
            <View style={formStyles.search}>
              <View style={ui.grow}>
                <Field
                  label="Search MyAnimeList"
                  value={query}
                  onChange={setQuery}
                  placeholder="Title in any language"
                  onKey={onSearchKey}
                  onFocusChange={setSearchFocused}
                  onSubmit={() => {
                    const picked = results[highlight];
                    (picked ? select(picked) : search()).catch(w.setError);
                  }}
                />
              </View>
              <IconButton
                icon="search"
                label={lookup ? 'Searching…' : 'Search'}
                active={lookup}
                disabled={lookup || query.trim().length < 2}
                onPress={() => {
                  search().catch(w.setError);
                }}
              />
            </View>
            {lookup && (
              <Text accessibilityLiveRegion="polite" style={ui.small}>
                Searching…
              </Text>
            )}
            <View style={formStyles.results}>
              {results.map((item, index) => {
                const chosen = draft.external?.malId === item.mal_id;
                return (
                  <HoverRow
                    key={item.mal_id}
                    label={`${item.title} (${item.type})`}
                    onPress={() => {
                      select(item).catch(w.setError);
                    }}
                    style={[
                      formStyles.result,
                      (chosen || index === highlight) && formStyles.selected,
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
                    <View style={[ui.grow, formStyles.resultText]}>
                      <Text
                        numberOfLines={2}
                        style={[ui.text, chosen && formStyles.selectedText]}
                      >
                        {item.title}
                      </Text>
                      {otherTitles(item).length > 0 && (
                        <Text numberOfLines={1} style={ui.muted}>
                          {otherTitles(item).join(' · ')}
                        </Text>
                      )}
                      <View style={formStyles.facts}>
                        {[
                          startYear(item),
                          item.type,
                          item.status,
                          item.episodes != null ? `${item.episodes} ep` : null,
                        ]
                          .filter(Boolean)
                          .map(fact => (
                            <Text key={String(fact)} style={formStyles.fact}>
                              {fact}
                            </Text>
                          ))}
                      </View>
                    </View>
                    <Icon
                      name={chosen ? 'check' : 'forward'}
                      color={chosen ? colors.accent : colors.muted}
                    />
                  </HoverRow>
                );
              })}
            </View>
            {searched &&
              !lookup &&
              results.length > 0 &&
              jikan.lastSource === 'myanimelist' && (
                <Text style={ui.small}>
                  Jikan is not responding, so these come straight from
                  MyAnimeList: genres and English/Japanese titles appear once
                  you pick one.
                </Text>
              )}
            {searched && !lookup && results.length === 0 && (
              <Text accessibilityLiveRegion="polite" style={ui.small}>
                No results. Try another spelling, or skip to enter it yourself.
              </Text>
            )}
            {selectedTitle !== '' && (
              <View style={formStyles.picked}>
                <Icon name="check" size={16} color={colors.accent} />
                <Text style={[ui.text, formStyles.selectedText, ui.grow]}>
                  Filled from {selectedTitle}
                </Text>
              </View>
            )}
          </View>
        );
      case 'details':
        return (
          <View style={formStyles.group}>
            <Field
              label="Title"
              value={draft.title}
              onChange={v => update('title', v)}
            />
            {(titleFeedback !== '' || duplicate) && draft.title !== '' && (
              <View style={formStyles.warning}>
                <Icon name="alert" size={16} color={colors.danger} />
                <Text
                  accessibilityLiveRegion="polite"
                  style={formStyles.warningText}
                >
                  {duplicate ? 'This entry already exists.' : titleFeedback}
                </Text>
              </View>
            )}
            {section.kind === 'anime' && (
              <View style={[formStyles.pair, phone && formStyles.pairPhone]}>
                <View style={ui.grow}>
                  <Field
                    label="Season"
                    value={draft.season}
                    onChange={v => update('season', v)}
                  />
                </View>
                <View style={ui.grow}>
                  <Field
                    label="Episode count"
                    value={String(draft.episodeCount)}
                    numeric
                    onChange={v => update('episodeCount', Number(v))}
                  />
                </View>
              </View>
            )}
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
            <Field
              label="Source / reading link"
              value={draft.link}
              onChange={v => update('link', v)}
              placeholder="https://…"
            />
          </View>
        );
      case 'metadata':
        return (
          <View style={formStyles.group}>
            {METADATA_GROUPS.map(group => (
              <MetadataPicker
                key={group}
                group={group}
                options={catalog[group].map(v => v.name)}
                selected={draft.metadata[group]}
                text={newValues[group] ?? ''}
                onText={value => setNewValues(v => ({ ...v, [group]: value }))}
                onToggle={value =>
                  update('metadata', {
                    ...draft.metadata,
                    [group]: draft.metadata[group].includes(value)
                      ? draft.metadata[group].filter(v => v !== value)
                      : [...draft.metadata[group], value],
                  })
                }
                onAdd={() => addValue(group)}
              />
            ))}
          </View>
        );
      case 'artwork':
        return (
          <View style={[formStyles.artwork, phone && formStyles.artworkPhone]}>
            <View style={formStyles.bigCover}>
              <Cover title={draft.title || 'New entry'} uri={coverSource} />
            </View>
            <View style={[ui.grow, formStyles.group]}>
              <FormAction
                accessibilityRole="button"
                accessibilityLabel="Choose cover image"
                onPress={chooseCover}
                style={formStyles.dropZone}
              >
                <Icon name="folder" size={28} color={colors.chrome} />
                <Text style={[ui.text, formStyles.strong]}>
                  {coverSource ? 'Choose a different image' : 'Choose an image'}
                </Text>
                {canDropFiles && (
                  <Text style={ui.small}>
                    or drop one anywhere on this window
                  </Text>
                )}
              </FormAction>
              <Text style={ui.small}>
                {draft.cover
                  ? 'Using your chosen image.'
                  : remoteCover
                  ? 'Using the MyAnimeList cover. It is downloaded when you add the title.'
                  : 'No cover yet. A placeholder is shown until you add one.'}
              </Text>
              {coverSource && (
                <View style={ui.row}>
                  <Button
                    label="Remove cover"
                    onPress={() => {
                      if (draft.cover) {
                        update('cover', null);
                      } else {
                        setRemoteCover('');
                      }
                    }}
                  />
                </View>
              )}
            </View>
          </View>
        );
      case 'review':
        return (
          <View style={formStyles.group}>
            <View
              style={[formStyles.artwork, phone && formStyles.artworkPhone]}
            >
              <View style={formStyles.reviewCover}>
                <Cover title={draft.title || 'New entry'} uri={coverSource} />
              </View>
              <View style={[ui.grow, formStyles.reviewList]}>
                <ReviewRow
                  label="Title"
                  value={draft.title}
                  onEdit={() => go(detailsAt)}
                />
                {section.kind === 'anime' && (
                  <ReviewRow
                    label="Season"
                    value={`${draft.season} · ${
                      draft.episodeCount || 0
                    } episodes`}
                    onEdit={() => go(detailsAt)}
                  />
                )}
                <ReviewRow
                  label="Status"
                  value={draft.status.replace('_', ' ')}
                  onEdit={() => go(detailsAt)}
                />
                <ReviewRow
                  label="Link"
                  value={draft.link || 'None'}
                  onEdit={() => go(detailsAt)}
                />
                {section.kind !== 'custom' &&
                  METADATA_GROUPS.map(group => (
                    <ReviewRow
                      key={group}
                      label={group.charAt(0).toUpperCase() + group.slice(1)}
                      value={draft.metadata[group].join(', ') || 'None'}
                      onEdit={() => go(steps.indexOf('metadata'))}
                    />
                  ))}
                <ReviewRow
                  label="Cover"
                  value={
                    draft.cover
                      ? 'Your image'
                      : remoteCover
                      ? 'MyAnimeList'
                      : 'None'
                  }
                  onEdit={() => go(steps.indexOf('artwork'))}
                />
              </View>
            </View>
            {addedValues.length > 0 && (
              <View style={formStyles.notice}>
                <Icon name="plus" size={16} color={colors.accent} />
                <Text style={[ui.small, formStyles.noticeText]}>
                  New metadata values will be added: {addedValues.join(', ')}
                </Text>
              </View>
            )}
            {section.kind === 'anime' && !w.settings.roots[sectionId] && (
              <Text style={ui.small}>
                No video folder is selected yet, so no title folder will be
                created. Choose one in Settings.
              </Text>
            )}
          </View>
        );
    }
  })();
  const last = step === steps.length - 1;
  const skipFind = stepKey === 'find' && selectedTitle === '';
  return (
    <PanelPage width={wide ? 1120 : 950} scrollRef={scroller}>
      <View
        style={[
          formStyles.column,
          wide && formStyles.wideColumn,
          phone && formStyles.phone,
        ]}
      >
        <View style={formStyles.titleRow}>
          <Text accessibilityRole="header" style={[ui.heading, ui.grow]}>
            Add {section.title}
          </Text>
          <Text style={formStyles.stepCount}>
            Step {step + 1} of {steps.length}
          </Text>
        </View>
        <Stepper
          steps={steps.map((key, index) => ({
            key,
            label: STEP_LABELS[key],
            done:
              index < step ||
              (key === 'find' && selectedTitle !== '') ||
              (key === 'details' && detailsValid) ||
              (key === 'metadata' && metadataCount > 0) ||
              (key === 'artwork' && coverSource !== null),
          }))}
          current={step}
          reachable={reachable}
          onSelect={go}
          compact={phone}
        />
        {!wide && stepKey !== 'review' && overview}
        <View style={[formStyles.body, wide && formStyles.bodyWide]}>
          <Reveal id={step} direction={direction} style={formStyles.stage}>
            <View style={formStyles.stageHead}>
              <Text style={ui.subheading}>{STEP_LABELS[stepKey]}</Text>
              <Text style={ui.muted}>{STEP_INTRO[stepKey]}</Text>
            </View>
            {content}
          </Reveal>
          {wide && stepKey !== 'review' && (
            <View style={formStyles.aside}>{overview}</View>
          )}
        </View>
        <View style={formStyles.footer}>
          {step > 0 && <Button label="Back" onPress={() => go(step - 1)} />}
          <View style={ui.grow} />
          {skipFind && (
            <Button
              label="Skip, enter it myself"
              onPress={() => go(step + 1)}
            />
          )}
          {last ? (
            <Button
              label={`Add ${section.title}`}
              primary
              disabled={w.busy || !detailsValid}
              onPress={() => {
                save().catch(w.setError);
              }}
            />
          ) : (
            !skipFind && (
              <Button
                label={`Next: ${STEP_LABELS[steps[step + 1]!]}`}
                primary
                disabled={step + 1 > reachable}
                onPress={() => go(step + 1)}
              />
            )
          )}
        </View>
      </View>
    </PanelPage>
  );
}

type StepKey = 'find' | 'details' | 'metadata' | 'artwork' | 'review';
const STEP_LABELS: Record<StepKey, string> = {
  find: 'Find',
  details: 'Details',
  metadata: 'Metadata',
  artwork: 'Artwork',
  review: 'Review',
};
const STEP_INTRO: Record<StepKey, string> = {
  find: 'Search MyAnimeList to fill everything in at once, or skip and type it yourself.',
  details: 'Check the basics. The title and season name its folder.',
  metadata:
    'Pick what describes it. Type to filter, or press Enter to add something new.',
  artwork: 'Use the MyAnimeList cover, or choose your own image.',
  review: 'Everything at a glance. Press any row to go back and change it.',
};

/** What the entry looks like so far; shown beside (or above) every step. */
function Overview({
  title,
  cover,
  lines,
  compact,
}: {
  title: string;
  cover: string | null;
  lines: string[];
  compact: boolean;
}): React.JSX.Element {
  return (
    <View
      accessibilityLabel="Overview"
      style={[formStyles.overview, compact && formStyles.overviewCompact]}
    >
      <View
        style={compact ? formStyles.overviewThumb : formStyles.overviewCover}
      >
        <Cover title={title || 'New entry'} uri={cover} />
      </View>
      <View style={[formStyles.overviewText, compact && ui.grow]}>
        <Text style={formStyles.overviewLabel}>Overview</Text>
        <Text numberOfLines={2} style={[ui.text, formStyles.strong]}>
          {title.trim() || 'Untitled'}
        </Text>
        {lines.map(line => (
          <Text key={line} numberOfLines={1} style={ui.small}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

function ReviewRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: () => void;
}): React.JSX.Element {
  return (
    <HoverRow
      label={`Edit ${label}`}
      onPress={onEdit}
      style={formStyles.reviewRow}
    >
      {hover => (
        <>
          <Text style={formStyles.reviewLabel}>{label}</Text>
          <Text
            numberOfLines={3}
            style={[ui.text, ui.grow, formStyles.reviewValue]}
          >
            {value}
          </Text>
          <Icon
            name="edit"
            size={14}
            color={hover ? colors.accent : colors.muted}
          />
        </>
      )}
    </HoverRow>
  );
}

const SHOWN = 18;

/** One metadata group: chosen values first, then a filterable set of the rest. */
function MetadataPicker({
  group,
  options,
  selected,
  text,
  onText,
  onToggle,
  onAdd,
}: {
  group: string;
  options: string[];
  selected: string[];
  text: string;
  onText: (value: string) => void;
  onToggle: (value: string) => void;
  onAdd: () => void;
}): React.JSX.Element {
  const [all, setAll] = useState(false);
  const name = group.charAt(0).toUpperCase() + group.slice(1);
  const needle = text.trim().toLowerCase();
  const rest = options.filter(
    v => !selected.includes(v) && (!needle || v.toLowerCase().includes(needle)),
  );
  const shown = all || needle ? rest : rest.slice(0, SHOWN);
  const exact = options.find(v => v.toLowerCase() === needle);
  return (
    <View style={formStyles.picker}>
      <View style={formStyles.pickerHead}>
        <Text style={[ui.text, formStyles.strong, ui.grow]}>{name}</Text>
        <Text style={ui.small}>
          {selected.length ? `${selected.length} chosen` : 'None chosen'}
        </Text>
      </View>
      {selected.length > 0 && (
        <View style={formStyles.chips}>
          {selected.map(value => (
            <Chip
              key={value}
              label={value}
              on
              onPress={() => onToggle(value)}
            />
          ))}
        </View>
      )}
      <View style={formStyles.search}>
        <View style={ui.grow}>
          <Field
            label={`Filter or add ${group}`}
            value={text}
            placeholder={`Type a ${group.replace(/s$/, '')}`}
            onChange={onText}
            onSubmit={() => {
              if (exact) {
                if (!selected.includes(exact)) {
                  onToggle(exact);
                }
                onText('');
              } else {
                onAdd();
              }
            }}
          />
        </View>
        {needle !== '' && !exact && (
          <IconButton
            icon="plus"
            label={`Add "${text.trim()}"`}
            onPress={onAdd}
          />
        )}
      </View>
      {shown.length > 0 && (
        <View style={formStyles.chips}>
          {shown.map(value => (
            <Chip key={value} label={value} onPress={() => onToggle(value)} />
          ))}
        </View>
      )}
      {!needle && rest.length > SHOWN && (
        <View style={ui.row}>
          <TextButton
            label={all ? 'Show fewer' : `Show all ${rest.length}`}
            onPress={() => setAll(v => !v)}
          />
        </View>
      )}
    </View>
  );
}

function Chip({
  label,
  on = false,
  onPress,
}: {
  label: string;
  on?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <FormAction
      accessibilityRole="button"
      accessibilityLabel={on ? `Remove ${label}` : `Add ${label}`}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[formStyles.chip, on && formStyles.chipOn]}
    >
      <Text style={[formStyles.chipText, on && formStyles.chipTextOn]}>
        {label}
      </Text>
      <Icon
        name={on ? 'close' : 'plus'}
        size={12}
        color={on ? colors.accent : colors.muted}
      />
    </FormAction>
  );
}

const formStyles = StyleSheet.create({
  column: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: 28 },
  wideColumn: { maxWidth: 1060 },
  phone: { gap: 22 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  stepCount: {
    fontFamily,
    fontSize: 13,
    color: colors.muted,
    paddingBottom: 8,
  },
  body: { gap: 24 },
  bodyWide: { flexDirection: 'row', alignItems: 'flex-start', gap: 40 },
  stage: { flex: 1, gap: 20, minWidth: 0 },
  stageHead: { gap: 4 },
  aside: { width: 230 },
  search: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  group: { gap: 18 },
  results: { gap: 4 },
  resultText: { gap: 3 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  fact: {
    fontFamily,
    fontSize: 11,
    color: colors.text,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.raised,
    overflow: 'hidden',
  },
  picked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
  },
  warning: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  warningText: { fontFamily, fontSize: 13, color: colors.danger },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  noticeText: { flexShrink: 1, color: colors.text },
  pair: { flexDirection: 'row', gap: 20 },
  pairPhone: { flexDirection: 'column', gap: 18 },
  resultCover: { width: 52 },
  selectedText: { color: colors.accent },
  selected: { backgroundColor: colors.accentSoft },
  strong: { fontWeight: '600' },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 10,
    borderRadius: 10,
  },
  picker: {
    gap: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pickerHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipText: { fontFamily, fontSize: 13, color: colors.muted },
  chipTextOn: { color: colors.mist },
  artwork: { flexDirection: 'row', gap: 28, alignItems: 'flex-start' },
  artworkPhone: { flexDirection: 'column' },
  bigCover: { width: 200 },
  reviewCover: { width: 170 },
  dropZone: {
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 20,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.line,
  },
  reviewList: { gap: 2 },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  reviewLabel: {
    width: 110,
    fontFamily,
    fontSize: 13,
    color: colors.muted,
    paddingTop: 2,
  },
  reviewValue: { fontSize: 15 },
  overview: {
    gap: 14,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#0E1A26',
  },
  overviewCompact: { flexDirection: 'row', alignItems: 'center' },
  overviewCover: { width: '100%' },
  overviewThumb: { width: 56 },
  overviewText: { gap: 3 },
  overviewLabel: {
    fontFamily,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 20,
    borderTopWidth: 1,
    borderColor: colors.line,
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
