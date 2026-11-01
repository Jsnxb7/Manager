import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import { Button, Choice, Field } from '../components/controls';
import { Cover } from '../components/Cover';
import { ui } from '../design/theme';
import { scanRelations } from '../services/relations';
import { METADATA_GROUPS, emptyMetadata } from '../domain/catalog';
import { EntryDraft, createEntry, metadataCatalog } from '../services/library';
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
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  const [remoteCover, setRemoteCover] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
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
  const search = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLookup(true);
    try {
      await new Promise<void>(resolve => setTimeout(resolve, 300));
      const items = await jikan.search(
        section.kind === 'anime' ? 'anime' : 'manga',
        query,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setResults(items);
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
  const select = async (result: SearchResult) => {
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
    w.run(async () => {
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
      await w.mutate(c => {
        const created = createEntry(c, sectionId, { ...draft, cover });
        if (created.kind === 'anime') {
          scanRelations(c, created.id);
        }
      });
      navigate({ name: 'library', sectionId });
    }, `${section.title} entry added`);
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
      Alert.alert('Add new metadata values?', extras.join(', '), [
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
  return (
    <ScrollView contentContainerStyle={ui.page}>
      <Text accessibilityRole="header" style={ui.heading}>
        Add {section.title}
      </Text>
      {section.kind !== 'custom' && (
        <View style={ui.card}>
          <Text style={ui.subheading}>Find metadata</Text>
          <Field label="Search Jikan" value={query} onChange={setQuery} />
          <Button
            label={lookup ? 'Searching…' : 'Search'}
            disabled={lookup || query.trim().length < 2}
            onPress={() => {
              search().catch(w.setError);
            }}
          />
          {results.map(item => (
            <Button
              key={item.mal_id}
              label={`${item.title} (${item.type})`}
              onPress={() => {
                select(item).catch(w.setError);
              }}
            />
          ))}
          <Text style={ui.small}>Optional. Manual entry works offline.</Text>
        </View>
      )}
      <Field
        label="Title"
        value={draft.title}
        onChange={v => update('title', v)}
      />
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
      {section.kind !== 'custom' &&
        METADATA_GROUPS.map(group => (
          <View key={group} style={ui.card}>
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
                <Button
                  key={value}
                  label={value}
                  primary={draft.metadata[group].includes(value)}
                  onPress={() =>
                    update('metadata', {
                      ...draft.metadata,
                      [group]: draft.metadata[group].includes(value)
                        ? draft.metadata[group].filter(v => v !== value)
                        : [...draft.metadata[group], value],
                    })
                  }
                />
              ))}
            </View>
            <Field
              label={`New ${group} value`}
              value={newValues[group] ?? ''}
              onChange={value => setNewValues(s => ({ ...s, [group]: value }))}
            />
            <Button
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
      <Button
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
            uri={`file://${w.io!.privateRoot}/${draft.cover}`}
          />
        </View>
      )}
      <Button
        label={`Add ${section.title}`}
        primary
        disabled={w.busy}
        onPress={confirmSave}
      />
    </ScrollView>
  );
}
const formStyles = { cover: { width: 160 } };
