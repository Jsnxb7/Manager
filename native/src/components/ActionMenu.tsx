import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { IconButton } from './Icon';
import { colors } from '../design/theme';

/**
 * A single "more" button whose actions slide out to its left (or drop below it)
 * when pressed, over whatever sits beside it, and tuck away again once one is
 * chosen.
 */
export function ActionMenu({
  children,
  size = 16,
  solid = false,
  label = 'More actions',
  direction = 'left',
}: {
  children: (close: () => void) => React.ReactNode;
  size?: number;
  solid?: boolean;
  label?: string;
  direction?: 'left' | 'down';
}): React.JSX.Element {
  const down = direction === 'down';
  const [open, setOpen] = useState(false);
  const reveal = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(reveal, {
      toValue: open ? 1 : 0,
      duration: 170,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, reveal]);
  const close = () => setOpen(false);
  const button = Math.max(8, Math.round(size * 0.45)) * 2 + size + 2;
  const slide = reveal.interpolate({
    inputRange: [0, 1],
    outputRange: [down ? -18 : 18, 0],
  });
  return (
    <View style={styles.anchor}>
      {open && (
        <Animated.View
          style={[
            styles.tray,
            down
              ? [styles.column, { top: button + 4, width: button + 8 }]
              : [styles.row, { right: button + 4, height: button + 8 }],
            {
              opacity: reveal,
              transform: [
                down ? { translateY: slide } : { translateX: slide },
                {
                  scale: reveal.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.9, 1],
                  }),
                },
              ],
            },
          ]}
        >
          {children(close)}
        </Animated.View>
      )}
      <IconButton
        icon={open ? 'close' : 'more'}
        label={open ? 'Close actions' : label}
        size={size}
        solid={solid || open}
        active={open}
        onPress={() => setOpen(value => !value)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'relative', zIndex: 5 },
  tray: {
    position: 'absolute',
    alignItems: 'center',
    gap: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#0A131DF2',
  },
  row: { top: -4, flexDirection: 'row', paddingHorizontal: 4 },
  column: { left: -4, flexDirection: 'column', paddingVertical: 4 },
});
