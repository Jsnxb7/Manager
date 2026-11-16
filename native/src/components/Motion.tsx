import React, { useLayoutEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleProp, ViewStyle } from 'react-native';

/** One easing for every page and step change: a quick start that settles softly. */
export const settle = Easing.bezier(0.22, 1, 0.36, 1);
/**
 * React Native Windows can leave a natively driven transform part-way through,
 * which left pages shifted sideways or dropped; there the JS driver runs it.
 */
export const nativeMotion = Platform.OS !== 'windows';

/**
 * Brings its children in whenever `id` changes: a short glide from the side the
 * user is heading towards, with a fade. `direction` 1 moves forward, -1 back,
 * 0 rises in place. Set `still` for native video views, which only fade.
 */
export function Reveal({
  id,
  direction = 0,
  distance = 28,
  duration = 320,
  still = false,
  style,
  children,
}: {
  id: string | number;
  direction?: number;
  distance?: number;
  duration?: number;
  still?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}): React.JSX.Element {
  const progress = useRef(new Animated.Value(0)).current;
  const from = useRef({ direction, distance });
  from.current = { direction, distance };
  // Before paint, so the new content never flashes in at its resting place.
  useLayoutEffect(() => {
    progress.setValue(0);
    const run = Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: settle,
      useNativeDriver: nativeMotion,
    });
    // Always lands exactly at rest, even if a frame was dropped or it was cut short.
    run.start(({ finished }) => finished && progress.setValue(1));
    return () => run.stop();
  }, [id, duration, progress]);
  const sideways = from.current.direction * from.current.distance;
  const transform = still
    ? []
    : sideways
    ? [
        {
          translateX: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [sideways, 0],
          }),
        },
      ]
    : [
        {
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [14, 0],
          }),
        },
      ];
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress.interpolate({
            inputRange: [0, 0.6, 1],
            outputRange: [0, 0.9, 1],
          }),
          transform,
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
