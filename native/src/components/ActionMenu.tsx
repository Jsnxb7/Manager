import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { IconButton } from './Icon';
import { nativeMotion, settle } from './Motion';
import { Popover, PopoverDivider, PopoverItem } from './Popover';
import type { MenuItem } from './ContextMenu';
import { colors } from '../design/theme';

/** One icon of the tray; each drops in a beat after the one above it. */
function TrayIcon({
  item,
  index,
  size,
  onDone,
}: {
  item: MenuItem;
  index: number;
  size: number;
  onDone: () => void;
}): React.JSX.Element {
  const drop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const run = Animated.timing(drop, {
      toValue: 1,
      duration: 220,
      delay: index * 35,
      easing: settle,
      useNativeDriver: nativeMotion,
    });
    run.start(({ finished }) => finished && drop.setValue(1));
    return () => run.stop();
  }, [drop, index]);
  return (
    <Animated.View
      style={{
        opacity: drop,
        transform: [
          {
            translateY: drop.interpolate({
              inputRange: [0, 1],
              outputRange: [-10, 0],
            }),
          },
        ],
      }}
    >
      <IconButton
        icon={item.icon}
        label={item.label}
        size={size}
        style={{ padding: Math.max(5, Math.round(size * 0.32)) }}
        disabled={!!item.disabled}
        {...(item.danger ? { color: colors.danger } : {})}
        onPress={() => {
          onDone();
          item.onPress();
        }}
      />
    </Animated.View>
  );
}

/**
 * A single "more" button. By default its actions open as a labelled menu
 * beneath it; `tray` drops them as a slim column of icons instead (the cards).
 * Danger actions sit apart at the bottom, so they are never one slip away.
 */
export function ActionMenu({
  items,
  size = 16,
  solid = false,
  label = 'More actions',
  align = 'end',
  tray = false,
  onOpenChange,
}: {
  items: MenuItem[];
  size?: number;
  solid?: boolean;
  label?: string;
  align?: 'start' | 'end';
  tray?: boolean;
  /** Lets a hover-revealed parent keep the button mounted while it is open. */
  onOpenChange?: (open: boolean) => void;
}): React.JSX.Element {
  const [open, setOpenState] = useState(false);
  const anchor = useRef<View | null>(null);
  const notify = useRef(onOpenChange);
  notify.current = onOpenChange;
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    notify.current?.(next);
  }, []);
  const close = useCallback(() => setOpen(false), [setOpen]);
  // If the button unmounts while open, the parent must not stay pinned.
  useEffect(() => () => notify.current?.(false), []);
  // The tray is icons only, so actions that cannot run are left out entirely.
  const shown = tray ? items.filter(item => !item.disabled) : items;
  const safe = shown.filter(item => !item.danger);
  const danger = shown.filter(item => item.danger);
  const row = (item: MenuItem) => (
    <PopoverItem
      key={item.label}
      label={item.label}
      icon={item.icon}
      danger={item.danger}
      disabled={item.disabled}
      onPress={() => {
        setOpen(false);
        item.onPress();
      }}
    />
  );
  const ordered = [...safe, ...danger];
  return (
    <View ref={anchor} collapsable={false} style={styles.anchor}>
      <IconButton
        icon={open ? 'close' : 'more'}
        label={open ? 'Close actions' : label}
        size={size}
        solid={solid || open}
        active={open}
        onPress={() => setOpen(!open)}
      />
      <Popover
        anchorRef={anchor}
        visible={open}
        onClose={close}
        align={tray ? 'start' : align}
        slim={tray}
      >
        {tray ? (
          <>
            {ordered.map((item, index) => (
              <React.Fragment key={item.label}>
                {item.danger && index === safe.length && safe.length > 0 && (
                  <View style={styles.trayRule} />
                )}
                <TrayIcon
                  item={item}
                  index={index}
                  size={size}
                  onDone={close}
                />
              </React.Fragment>
            ))}
          </>
        ) : (
          <>
            {safe.map(row)}
            {safe.length > 0 && danger.length > 0 && <PopoverDivider />}
            {danger.map(row)}
          </>
        )}
      </Popover>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { alignSelf: 'flex-start' },
  trayRule: {
    width: '50%',
    height: 1,
    marginVertical: 2,
    backgroundColor: colors.line,
  },
});
