import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Catalog, Entry } from '../domain/catalog';
import { colors, fontFamily, noFocusRing, ui } from '../design/theme';
import { RatingBadge } from './Badges';
import { Sheet } from './controls';
import { Cover, coverUri } from './Cover';
import { Icon } from './Icon';

const LIMIT = 40;

/** Titles whose name, season, notes or metadata contain every typed word. */
export function searchCatalog(catalog: Catalog, query: string): Entry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [];
  }
  const scored: { entry: Entry; score: number }[] = [];
  for (const entry of catalog.entries) {
    const title = entry.title.toLowerCase();
    const haystack = [
      title,
      entry.season,
      entry.notes,
      ...Object.values(entry.metadata).flat(),
    ]
      .join('\n')
      .toLowerCase();
    if (!words.every(w => haystack.includes(w))) {
      continue;
    }
    // Title starts first, then title contains, then other matches.
    const phrase = words.join(' ');
    const score = title.startsWith(phrase)
      ? 0
      : title.includes(phrase)
      ? 1
      : words.every(w => title.includes(w))
      ? 2
      : 3;
    scored.push({ entry, score });
  }
  return scored
    .sort(
      (a, b) => a.score - b.score || a.entry.title.localeCompare(b.entry.title),
    )
    .map(s => s.entry);
}

/** Search every section at once (Ctrl+K on PC). */
export function GlobalSearch({
  visible,
  onClose,
  catalog,
  privateRoot,
  onOpen,
}: {
  visible: boolean;
  onClose: () => void;
  catalog: Catalog | null;
  privateRoot: string | undefined;
  onOpen: (entry: Entry) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const results = useMemo(
    () => (catalog ? searchCatalog(catalog, query) : []),
    [catalog, query],
  );
  const sections = new Map(catalog?.sections.map(s => [s.id, s.title]));
  const close = () => {
    setQuery('');
    onClose();
  };
  const open = (entry: Entry) => {
    close();
    onOpen(entry);
  };
  return (
    <Sheet title="Search everything" visible={visible} onClose={close}>
      <View style={styles.field}>
        <Icon name="search" size={16} color={colors.muted} />
        <TextInput
          {...noFocusRing}
          autoFocus
          accessibilityLabel="Search all sections"
          placeholder="Titles, seasons, genres, notes"
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => results[0] && open(results[0])}
          returnKeyType="go"
          style={styles.input}
        />
      </View>
      <Text style={ui.small}>
        {!query.trim()
          ? `Searches all ${
              catalog?.entries.length ?? 0
            } titles in every section. Enter opens the first result.`
          : results.length
          ? `${results.length} title${results.length === 1 ? '' : 's'}${
              results.length > LIMIT ? `, showing the first ${LIMIT}` : ''
            }`
          : 'Nothing matches. Try fewer or shorter words.'}
      </Text>
      <View style={styles.list}>
        {results.slice(0, LIMIT).map(entry => (
          <Result
            key={entry.id}
            entry={entry}
            section={sections.get(entry.sectionId) ?? ''}
            uri={entry.cover ? coverUri(entry, privateRoot) : null}
            onPress={() => open(entry)}
          />
        ))}
      </View>
    </Sheet>
  );
}

function Result({
  entry,
  section,
  uri,
  onPress,
}: {
  entry: Entry;
  section: string;
  uri: string | null;
  onPress: () => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="link"
      accessibilityLabel={`${entry.title}, ${section}`}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={[styles.row, hover && styles.rowLit]}
    >
      <View style={styles.cover}>
        <Cover uri={uri} title={entry.title} />
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.title, hover && styles.lit]}>
          {entry.title}
        </Text>
        <Text numberOfLines={1} style={ui.small}>
          {[section, entry.season].filter(Boolean).join(', ')}
        </Text>
      </View>
      <RatingBadge rating={entry.rating} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.background,
    minWidth: 300,
  },
  input: {
    flex: 1,
    fontFamily,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 10,
  },
  list: { gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 6,
    borderRadius: 8,
  },
  rowLit: { backgroundColor: colors.rowHover },
  cover: { width: 36 },
  copy: { flex: 1, gap: 2 },
  title: { fontFamily, fontSize: 15, fontWeight: '600', color: colors.text },
  lit: { color: colors.mist },
});
