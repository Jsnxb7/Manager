import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily } from '../design/theme';
import { SkeletonBlock } from './Skeleton';
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
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [uri]);
  return (
    <View style={styles.frame}>
      {uri && !failed ? (
        <>
          {!loaded && <SkeletonBlock style={StyleSheet.absoluteFill} />}
          <Image
            accessibilityLabel={`${title} cover`}
            source={{ uri: normalizeImageUri(uri) }}
            style={[styles.image, dim && styles.dim]}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            resizeMode="cover"
          />
        </>
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
  // A hair larger than its frame: at fractional display scaling a rounded size
  // otherwise leaves a one-pixel line of background along an edge.
  image: { width: '100%', height: '100%', transform: [{ scale: 1.02 }] },
  dim: { opacity: 0.55 },
  letter: { fontFamily, color: colors.line, fontSize: 56, fontWeight: '300' },
});
