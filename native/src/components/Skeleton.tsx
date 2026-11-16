import React, { useEffect } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { colors, ui } from '../design/theme';
import { useViewport } from '../design/viewport';

// One shared pulse keeps every placeholder on the page breathing in step.
const pulse = new Animated.Value(0);
let users = 0;
let loop: Animated.CompositeAnimation | null = null;
function usePulse(): Animated.AnimatedInterpolation<number> {
  useEffect(() => {
    users += 1;
    if (!loop) {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1,
            duration: 750,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: Platform.OS !== 'windows',
          }),
          Animated.timing(pulse, {
            toValue: 0,
            duration: 750,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: Platform.OS !== 'windows',
          }),
        ]),
      );
      loop.start();
    }
    return () => {
      users -= 1;
      if (users === 0 && loop) {
        loop.stop();
        loop = null;
        pulse.setValue(0);
      }
    };
  }, []);
  return pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] });
}

/** A pulsing graphite placeholder shaped by `style`. */
export function SkeletonBlock({
  style,
}: {
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const opacity = usePulse();
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.block, style, { opacity }]}
    />
  );
}

/** Placeholder library page shown while the catalog opens. */
export function LibrarySkeleton(): React.JSX.Element {
  const { width } = useViewport();
  const phone = width < 700;
  const inner = Math.max(240, width - 48);
  const gap = 16;
  const columns = Math.max(2, Math.floor((inner + gap) / (phone ? 140 : 180)));
  const card = (inner - gap * (columns - 1)) / columns;
  return (
    <View
      style={ui.page}
      accessible
      accessibilityLabel="Opening your local library"
    >
      <SkeletonBlock style={styles.heading} />
      <SkeletonBlock style={styles.subheading} />
      <View style={[styles.grid, { gap }]}>
        {Array.from({ length: columns * 2 }, (_, i) => (
          <View key={i} style={[styles.card, { width: card }]}>
            <SkeletonBlock style={styles.cover} />
            <SkeletonBlock style={styles.line} />
            <SkeletonBlock style={styles.shortLine} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.raised, borderRadius: 6 },
  heading: { width: 260, maxWidth: '70%', height: 34 },
  subheading: { width: 180, maxWidth: '50%', height: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  card: { gap: 8 },
  cover: { aspectRatio: 0.7, width: '100%' },
  line: { height: 12, width: '85%', borderRadius: 4 },
  shortLine: { height: 12, width: '50%', borderRadius: 4 },
});
