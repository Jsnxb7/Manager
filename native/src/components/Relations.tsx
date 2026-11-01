import { Cover } from './Cover';
import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import { Button, Field, ProgressBar } from './controls';
import { ui } from '../design/theme';
import {
  addRelation,
  relationFor,
  removeRelation,
  reorderRelation,
  scanRelations,
} from '../services/relations';
import { watchedPercent } from '../services/library';
export function Relations({
  workspace: w,
  entryId,
  navigate,
}: {
  workspace: Workspace;
  entryId: string;
  navigate: (route: Route) => void;
}): React.JSX.Element {
  const group = relationFor(w.catalog!, entryId);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [query, setQuery] = useState('');
  const order = draft ?? group?.entryIds ?? [entryId];
  const action = (job: () => Promise<void>) => {
    w.run(job).catch(w.setError);
  };
  return (
    <View style={ui.card}>
      <Text style={ui.subheading}>Related Anime</Text>
      <Text style={ui.muted}>
        Arrange seasons, specials and movies in playback order.
      </Text>
      <View style={ui.row}>
        {draft ? (
          <>
            <Button
              label="Save order"
              primary
              onPress={() =>
                action(async () => {
                  await w.mutate(c => reorderRelation(c, entryId, draft));
                  setDraft(null);
                })
              }
            />
            <Button label="Cancel" onPress={() => setDraft(null)} />
          </>
        ) : (
          <Button
            label="Edit order"
            disabled={!group}
            onPress={() => setDraft([...order])}
          />
        )}
        <Button
          label="Reset default"
          disabled={!group || !!draft}
          onPress={() =>
            action(() => w.mutate(c => reorderRelation(c, entryId, null)))
          }
        />
        <Button
          label="Check relations"
          disabled={!!draft}
          onPress={() => action(() => w.mutate(c => scanRelations(c, entryId)))}
        />
      </View>
      <Text style={ui.small}>
        {group?.mode === 'custom'
          ? 'Custom watch order'
          : 'Automatic watch order'}
      </Text>
      {order.map((id, index) => {
        const e = w.catalog!.entries.find(v => v.id === id)!;
        return (
          <View key={id} style={ui.card}>
            {e.cover && (
              <View style={ui.thumbnail}>
                <Cover
                  title={e.title}
                  uri={`file://${w.io!.privateRoot}/${e.cover}`}
                />
              </View>
            )}
            <Text style={ui.text}>
              {index + 1}. {e.title}
              {id === entryId ? ' · Current' : ''}
            </Text>
            <Text style={ui.muted}>
              {e.season} · {Math.round(watchedPercent(e))}% completed
            </Text>
            <ProgressBar
              label={`${e.title} completion`}
              value={watchedPercent(e)}
            />
            <View style={ui.row}>
              <Button
                label="Open"
                onPress={() => navigate({ name: 'details', animeId: id })}
              />
              {draft && (
                <>
                  <Button
                    label="Move up"
                    disabled={index === 0}
                    onPress={() =>
                      setDraft(items => {
                        const next = [...items!];
                        [next[index - 1], next[index]] = [
                          next[index]!,
                          next[index - 1]!,
                        ];
                        return next;
                      })
                    }
                  />
                  <Button
                    label="Move down"
                    disabled={index === order.length - 1}
                    onPress={() =>
                      setDraft(items => {
                        const next = [...items!];
                        [next[index], next[index + 1]] = [
                          next[index + 1]!,
                          next[index]!,
                        ];
                        return next;
                      })
                    }
                  />
                </>
              )}
              {id !== entryId && (
                <Button
                  label="Remove relation"
                  danger
                  disabled={!!draft}
                  onPress={() =>
                    Alert.alert(
                      'Remove relation?',
                      'Automatic checks will respect this removal.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Remove',
                          onPress: () =>
                            action(() =>
                              w.mutate(c => removeRelation(c, entryId, id)),
                            ),
                        },
                      ],
                    )
                  }
                />
              )}
            </View>
          </View>
        );
      })}
      <Field
        label="Find local anime to add"
        value={query}
        onChange={setQuery}
      />
      {query.trim().length >= 2 &&
        w
          .catalog!.entries.filter(
            e =>
              e.kind === 'anime' &&
              !order.includes(e.id) &&
              `${e.title} ${e.season}`
                .toLowerCase()
                .includes(query.toLowerCase()),
          )
          .slice(0, 12)
          .map(e => (
            <Button
              key={e.id}
              disabled={!!draft}
              label={`Add ${e.title} (${e.season})`}
              onPress={() =>
                action(async () => {
                  await w.mutate(c => addRelation(c, entryId, e.id));
                  setQuery('');
                })
              }
            />
          ))}
    </View>
  );
}
