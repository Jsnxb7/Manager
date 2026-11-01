import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Entry, METADATA_GROUPS } from '../domain/catalog';
import { ui } from '../design/theme';
import { cleanTitle, entryById } from '../services/library';
import { importCover } from '../services/media';
import { Choice, Field, Sheet, TextButton } from './controls';
import { Cover } from './Cover';

export function DetailsEditor({
  workspace: w,
  entry,
  onClose,
}: {
  workspace: Workspace;
  entry: Entry;
  onClose: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(entry.title);
  const [season, setSeason] = useState(entry.season);
  const [status, setStatus] = useState(entry.status);
  const [metadata, setMetadata] = useState(() => ({
    genres: entry.metadata.genres.join(', '),
    themes: entry.metadata.themes.join(', '),
    demographics: entry.metadata.demographics.join(', '),
    tags: entry.metadata.tags.join(', '),
  }));
  const [coverSource, setCoverSource] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      cleanTitle(title);
      if (!season.trim()) {
        throw new Error('Enter a season.');
      }
      const values = Object.fromEntries(
        METADATA_GROUPS.map(group => [
          group,
          [
            ...new Set(
              metadata[group]
                .split(',')
                .map(value => value.trim())
                .filter(Boolean),
            ),
          ],
        ]),
      ) as Entry['metadata'];
      if (!METADATA_GROUPS.some(group => values[group].length)) {
        throw new Error('Select or add at least one metadata value.');
      }
      const cover = coverSource
        ? await importCover(w.io!, coverSource)
        : undefined;
      await w.mutate(c => {
        const current = entryById(c, entry.id);
        const compare = (value: string) => value.trim().toLowerCase();
        if (
          c.entries.some(
            other =>
              other.id !== current.id &&
              ((other.sectionId === current.sectionId &&
                compare(other.title) === compare(title) &&
                compare(other.season) === compare(season) &&
                other.status === status) ||
                (current.external &&
                  other.kind === current.kind &&
                  other.external?.malId === current.external.malId)),
          )
        ) {
          throw new Error('This entry already exists.');
        }
        current.title = title.trim();
        current.season = season.trim();
        current.status = status;
        current.metadata = values;
        if (cover !== undefined) {
          current.cover = cover;
        }
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet title="Edit title" visible onClose={onClose}>
      <Field label="Title" value={title} onChange={setTitle} />
      <Field label="Season" value={season} onChange={setSeason} />
      <Choice
        label="Release status"
        inline
        values={['Ongoing', 'Completed', 'Not_Aired']}
        value={status}
        onChange={value => setStatus(value as Entry['status'])}
      />
      {METADATA_GROUPS.map(group => (
        <Field
          key={group}
          label={`${group[0]!.toUpperCase()}${group.slice(
            1,
          )} (comma separated)`}
          value={metadata[group]}
          onChange={value =>
            setMetadata(previous => ({ ...previous, [group]: value }))
          }
        />
      ))}
      {coverSource && (
        <View style={styles.cover}>
          <Cover title={title} uri={coverSource} />
        </View>
      )}
      <TextButton
        label="Choose cover"
        disabled={saving}
        onPress={() => {
          w.run(async () => {
            const source = (await w.io!.pickFiles('image'))[0];
            if (source) {
              setCoverSource(source);
            }
          }).catch(w.setError);
        }}
      />
      <Text style={ui.small}>
        Title and season edits keep the linked media folder unchanged.
      </Text>
      <View style={ui.row}>
        <TextButton
          label="Save changes"
          disabled={saving}
          onPress={() => {
            w.run(save, 'Title updated').catch(w.setError);
          }}
        />
        <TextButton label="Cancel" disabled={saving} onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({ cover: { width: 100 } });
