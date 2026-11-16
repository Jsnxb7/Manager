import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { settle } from './Motion';
import { colors, fontFamily, noFocusRing } from '../design/theme';

export type Step = { key: string; label: string; done: boolean };

/**
 * Numbered steps joined by a track that fills as the user moves along. Steps
 * already reached can be revisited; later ones open once everything before is valid.
 */
export function Stepper({
  steps,
  current,
  reachable,
  onSelect,
  compact = false,
}: {
  steps: Step[];
  current: number;
  /** The furthest step the user may jump to. */
  reachable: number;
  onSelect: (index: number) => void;
  compact?: boolean;
}): React.JSX.Element {
  const fill = useRef(new Animated.Value(current)).current;
  useEffect(() => {
    Animated.timing(fill, {
      toValue: current,
      duration: 360,
      easing: settle,
      useNativeDriver: false,
    }).start();
  }, [current, fill]);
  const last = Math.max(1, steps.length - 1);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${current + 1} of ${steps.length}: ${
        steps[current]?.label ?? ''
      }`}
      style={styles.wrap}
    >
      <View style={styles.trackLayer}>
        <View style={styles.track}>
          <Animated.View
            style={[
              styles.trackFill,
              {
                width: fill.interpolate({
                  inputRange: [0, last],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>
      </View>
      <View style={styles.row}>
        {steps.map((step, index) => (
          <StepDot
            key={step.key}
            step={step}
            index={index}
            state={
              index === current
                ? 'current'
                : index < current || (step.done && index <= reachable)
                ? 'done'
                : 'todo'
            }
            disabled={index > reachable}
            compact={compact}
            onPress={() => onSelect(index)}
          />
        ))}
      </View>
    </View>
  );
}

function StepDot({
  step,
  index,
  state,
  disabled,
  compact,
  onPress,
}: {
  step: Step;
  index: number;
  state: 'current' | 'done' | 'todo';
  disabled: boolean;
  compact: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const current = state === 'current';
  const done = state === 'done';
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="button"
      accessibilityLabel={`${step.label}${done ? ', done' : ''}`}
      accessibilityState={{ selected: current, disabled }}
      disabled={disabled || current}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={styles.step}
    >
      <View
        style={[
          styles.dot,
          done && styles.dotDone,
          current && styles.dotCurrent,
          hover && !disabled && !current && styles.dotHover,
        ]}
      >
        {done ? (
          <Icon name="check" size={14} color={colors.background} />
        ) : (
          <Text style={[styles.number, current && styles.numberCurrent]}>
            {index + 1}
          </Text>
        )}
      </View>
      {(!compact || current) && (
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            (current || done) && styles.labelLit,
            current && styles.labelCurrent,
            disabled && styles.labelOff,
          ]}
        >
          {step.label}
        </Text>
      )}
    </Pressable>
  );
}

const DOT = 30;
const styles = StyleSheet.create({
  wrap: { position: 'relative', paddingTop: 2 },
  trackLayer: {
    position: 'absolute',
    top: 2 + DOT / 2 - 1,
    left: 36,
    right: 36,
  },
  track: {
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  trackFill: { height: 2, backgroundColor: colors.accent },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  step: { width: 72, alignItems: 'center', gap: 8 },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.background,
  },
  dotHover: { borderColor: colors.accent },
  dotDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  dotCurrent: {
    borderColor: colors.chrome,
    backgroundColor: colors.raised,
    borderWidth: 2,
  },
  number: { fontFamily, fontSize: 13, fontWeight: '600', color: colors.muted },
  numberCurrent: { color: colors.mist },
  label: {
    fontFamily,
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
  },
  labelLit: { color: colors.text },
  labelCurrent: { color: colors.mist, fontWeight: '600' },
  labelOff: { opacity: 0.6 },
});
