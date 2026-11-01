import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import { normalizeImageUri } from '../components/Cover';
import { Button, Field, Sheet } from '../components/controls';
import { colors, ui } from '../design/theme';
export function Hub({
  workspace: w,
  navigate,
}: {
  workspace: Workspace;
  navigate: (route: Route) => void;
}): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const create = () =>
    w.run(async () => {
      const title = name.trim();
      const slug = title.toLowerCase().replace(/\s+/g, '_');
      if (
        !/^[\p{L}\p{N}_-]+$/u.test(slug) ||
        [
          'queue',
          'player',
          'custom',
          'settings',
          'data',
          'static',
          'api',
        ].includes(slug)
      ) {
        throw new Error(
          'Use a section name containing letters, numbers, spaces or dashes.',
        );
      }
      await w.mutate(c => {
        if (c.sections.some(s => s.id === slug)) {
          throw new Error('This section already exists.');
        }
        c.sections.push({ id: slug, title, kind: 'custom' });
      });
      setName('');
      setAdding(false);
    }, 'Section created');
  return (
    <ScrollView contentContainerStyle={ui.page}>
      <View style={ui.row}>
        <View style={ui.grow}>
          <Text accessibilityRole="header" style={ui.heading}>
            Content Hub
          </Text>
          <Text style={ui.muted}>
            A place for everything you watch and read.
          </Text>
        </View>
        <Button label="Add section" primary onPress={() => setAdding(true)} />
      </View>
      <View style={styles.grid}>
        {w.catalog?.sections.map(section => {
          const entries = w.catalog!.entries.filter(
            e => e.sectionId === section.id,
          );
          const covers = entries.filter(e => e.cover).slice(0, 3);
          return (
            <View key={section.id} style={styles.section}>
              <View style={styles.collage}>
                {covers.length ? (
                  covers.map(entry => (
                    <Image
                      key={entry.id}
                      source={{
                        uri: normalizeImageUri(
                          `file://${w.io?.privateRoot}/${entry.cover}`,
                        ),
                      }}
                      style={styles.cover}
                      accessibilityIgnoresInvertColors
                    />
                  ))
                ) : (
                  <Text style={styles.emptyArt}>
                    {section.title.slice(0, 1)}
                  </Text>
                )}
              </View>
              <View style={styles.copy}>
                <Text style={ui.subheading}>{section.title}</Text>
                <Text style={ui.muted}>{entries.length} items</Text>
                <Button
                  label={`Browse ${section.title}`}
                  onPress={() =>
                    navigate({ name: 'library', sectionId: section.id })
                  }
                />
              </View>
            </View>
          );
        })}
      </View>
      <Sheet
        title="Add content section"
        visible={adding}
        onClose={() => setAdding(false)}
      >
        <Field
          label="Section name"
          value={name}
          onChange={setName}
          placeholder="Movies, Drama, TV Shows…"
        />
        <Button
          label="Create section"
          primary
          disabled={w.busy}
          onPress={() => {
            create().catch(w.setError);
          }}
        />
      </Sheet>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  section: {
    minWidth: 240,
    maxWidth: 420,
    flexGrow: 1,
    flexBasis: 280,
    backgroundColor: colors.panel,
    borderRadius: 10,
    overflow: 'hidden',
  },
  collage: {
    height: 190,
    flexDirection: 'row',
    backgroundColor: colors.raised,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  cover: { height: 210, flex: 1, resizeMode: 'cover' },
  emptyArt: { fontSize: 76, color: colors.chrome, fontWeight: '300' },
  copy: { padding: 20, gap: 10 },
});
