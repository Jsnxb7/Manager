import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../design/theme';
export function normalizeImageUri(uri: string): string {
  const clean = uri.replace(/\\/g, '/');
  return /^file:\/\/[a-z]:/i.test(clean)
    ? clean.replace('file://', 'file:///')
    : clean;
}
export function Cover({
  uri,
  title,
}: {
  uri: string | null;
  title: string;
}): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return (
    <View style={styles.frame}>
      {uri && !failed ? (
        <Image
          accessibilityLabel={`${title} cover`}
          source={{ uri: normalizeImageUri(uri) }}
          style={styles.image}
          onError={() => setFailed(true)}
          resizeMode="cover"
        />
      ) : (
        <Text style={styles.letter}>{title.slice(0, 1)}</Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  frame: {
    aspectRatio: 0.7,
    backgroundColor: colors.raised,
    overflow: 'hidden',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  letter: { color: colors.chrome, fontSize: 56, fontWeight: '300' },
});
