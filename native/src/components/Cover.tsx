import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily } from '../design/theme';
export function normalizeImageUri(uri: string): string {
  const clean = uri.replace(/\\/g, '/');
  return /^file:\/\/[a-z]:/i.test(clean)
    ? clean.replace('file://', 'file:///')
    : clean;
}
export function coverUri(
  entry: { cover: string | null },
  privateRoot: string | undefined,
): string {
  return normalizeImageUri(
    /^file:/i.test(entry.cover ?? '')
      ? entry.cover!
      : `file://${privateRoot}/${entry.cover}`,
  );
}
export function Cover({
  uri,
  title,
  dim = false,
  children,
}: {
  uri: string | null;
  title: string;
  dim?: boolean;
  children?: React.ReactNode;
}): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return (
    <View style={styles.frame}>
      {uri && !failed ? (
        <Image
          accessibilityLabel={`${title} cover`}
          source={{ uri: normalizeImageUri(uri) }}
          style={[styles.image, dim && styles.dim]}
          onError={() => setFailed(true)}
          resizeMode="cover"
        />
      ) : (
        <Text style={styles.letter}>{title.slice(0, 1)}</Text>
      )}
      {children}
    </View>
  );
}
const styles = StyleSheet.create({
  frame: {
    aspectRatio: 0.7,
    overflow: 'hidden',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  dim: { opacity: 0.55 },
  letter: { fontFamily, color: colors.line, fontSize: 56, fontWeight: '300' },
});
