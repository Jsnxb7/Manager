import React, { useState } from 'react';
import {
  GestureResponderEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Sheet } from './controls';
import { Icon, IconName } from './Icon';
import { colors, fontFamily, noFocusRing } from '../design/theme';

export type MenuItem = {
  label: string;
  icon: IconName;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
};

/**
 * Props for a Pressable that opens its item's menu on a long press (touch) or a
 * right-click (PC). React Native Windows reports the mouse button on touch events
 * but never turns a right-click into a press, so it is caught on touch end.
 */
export function contextPress(open: () => void): {
  onLongPress: () => void;
  delayLongPress: number;
  onTouchEnd?: (e: GestureResponderEvent) => void;
} {
  return {
    onLongPress: open,
    delayLongPress: 450,
    ...(Platform.OS === 'windows'
      ? {
          onTouchEnd: (e: GestureResponderEvent) => {
            if (
              (e.nativeEvent as unknown as { button?: number }).button === 2
            ) {
              open();
            }
          },
        }
      : {}),
  };
}

/** Menu state plus the props that open it, for one row or card. */
export function useContextMenu(): {
  visible: boolean;
  open: () => void;
  close: () => void;
  pressProps: ReturnType<typeof contextPress>;
} {
  const [visible, setVisible] = useState(false);
  const open = () => setVisible(true);
  return {
    visible,
    open,
    close: () => setVisible(false),
    pressProps: contextPress(open),
  };
}

export function ContextMenu({
  title,
  visible,
  onClose,
  items,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  items: MenuItem[];
}): React.JSX.Element | null {
  return (
    <Sheet title={title} visible={visible} onClose={onClose}>
      <View accessibilityRole="menu" style={styles.list}>
        {items.map(item => (
          <MenuRow
            key={item.label}
            item={item}
            onPress={() => {
              onClose();
              item.onPress();
            }}
          />
        ))}
      </View>
    </Sheet>
  );
}

function MenuRow({
  item,
  onPress,
}: {
  item: MenuItem;
  onPress: () => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const tint = item.disabled
    ? colors.muted
    : item.danger
    ? colors.danger
    : colors.chrome;
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="menuitem"
      accessibilityLabel={item.label}
      accessibilityState={{ disabled: !!item.disabled }}
      disabled={item.disabled}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onPress={onPress}
      style={[styles.row, hover && !item.disabled && styles.rowLit]}
    >
      <Icon name={item.icon} size={18} color={tint} />
      <Text
        style={[
          styles.label,
          { color: item.danger ? tint : item.disabled ? tint : colors.text },
        ]}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: 2, minWidth: 240 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  rowLit: { backgroundColor: colors.rowHover },
  label: { fontFamily, fontSize: 16 },
});
