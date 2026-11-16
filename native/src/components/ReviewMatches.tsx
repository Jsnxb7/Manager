import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Episode } from '../domain/catalog';
import { colors, fontFamily, ui } from '../design/theme';
import { Availability } from '../services/media';
import { FolderMatch } from '../services/episodeMatch';
import { Sheet } from './controls';
import { IconButton } from './Icon';

/**
 * Which file each episode plays and why, so a wrong guess is visible and can be
 * corrected with Locate. Nothing here changes until Locate is used.
 */
export function ReviewMatches({
  visible,
  onClose,
  episodes,
  availability,
  folder,
  onLocate,
}: {
  visible: boolean;
  onClose: () => void;
  episodes: Episode[];
  availability: Record<string, Availability>;
  folder: FolderMatch | null;
  onLocate: (episode: Episode) => void;
}): React.JSX.Element {
  const checking = Object.keys(availability).length === 0;
  return (
    <Sheet title="Review matches" visible={visible} onClose={onClose}>
      <Text style={ui.small}>
        {checking
          ? 'Checking the folder…'
          : folder?.offset
          ? `This folder numbers its episodes from ${
              1 + folder.offset
            }, so episode 1 is file ${1 + folder.offset}.`
          : 'Each episode, the file it plays and why that file was chosen.'}
      </Text>
      <View style={styles.list}>
        {episodes.map(ep => {
          const value = availability[ep.id];
          const ok = value?.state === 'available';
          return (
            <View key={ep.id} style={styles.row}>
              <Text style={[styles.number, !ok && styles.numberOff]}>
                {ep.number}
              </Text>
              <View style={styles.copy}>
                <Text
                  numberOfLines={2}
                  style={[styles.file, !ok && styles.fileOff]}
                >
                  {!value
                    ? 'Checking…'
                    : value.state === 'available'
                    ? value.name ?? value.uri
                    : value.state === 'ambiguous'
                    ? `${value.files?.length ?? 2} files claim this episode`
                    : 'No file'}
                </Text>
                {value && (
                  <Text numberOfLines={3} style={ui.small}>
                    {value.state === 'available'
                      ? value.reason ?? ''
                      : value.state === 'ambiguous'
                      ? (value.files ?? []).join('\n')
                      : value.message}
                  </Text>
                )}
              </View>
              <IconButton
                icon="search"
                label={`Locate the file for episode ${ep.number}`}
                size={16}
                onPress={() => onLocate(ep)}
              />
            </View>
          );
        })}
      </View>
      {folder && folder.newEpisodes.length > 0 && (
        <Group
          title="Not in this title yet"
          lines={folder.newEpisodes.map(
            n => `Episode ${n.number}: ${n.file.name}`,
          )}
        />
      )}
      {folder && folder.extras.length > 0 && (
        <Group
          title="Left out as extras"
          lines={folder.extras.map(f => f.name)}
        />
      )}
      {folder && folder.unmatched.length > 0 && (
        <Group
          title="No episode number found"
          lines={folder.unmatched.map(f => f.name)}
        />
      )}
    </Sheet>
  );
}

function Group({
  title,
  lines,
}: {
  title: string;
  lines: string[];
}): React.JSX.Element {
  return (
    <View style={styles.group}>
      <View style={ui.rule} />
      <Text style={ui.subheading}>{title}</Text>
      {lines.map(line => (
        <Text key={line} style={ui.small}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 2, minWidth: 280 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  number: {
    width: 32,
    textAlign: 'right',
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: colors.accent,
  },
  numberOff: { color: colors.muted },
  copy: { flex: 1, gap: 2 },
  file: { fontFamily, fontSize: 14, color: colors.text },
  fileOff: { color: colors.danger },
  group: { gap: 6 },
});
