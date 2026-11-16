/* eslint-disable react-native/no-inline-styles -- placement is computed from the anchor */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Icon, IconName } from './Icon';
import { useEscape } from '../app/keys';
import { nativeMotion } from './Motion';
import { colors, fontFamily, noFocusRing } from '../design/theme';

/**
 * Small menus that drop from the control that opened them, drawn over the whole
 * window so scroll views and cards never clip them. Sheets stay for longer forms.
 */
type Frame = { x: number; y: number; width: number; height: number };
type OpenPopover = {
  id: object;
  anchor: Frame;
  align: 'start' | 'end';
  width?: number | undefined;
  /** A slim column as wide as its anchor (the cards' icon tray). */
  slim?: boolean | undefined;
  onClose: () => void;
  children: React.ReactNode;
};

let open: OpenPopover[] = [];
const listeners = new Set<() => void>();
function write(next: OpenPopover[]): void {
  open = next;
  listeners.forEach(listener => listener());
}
export function popoverCount(): number {
  return open.length;
}
export function subscribePopovers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const GAP = 6;
const EDGE = 12;

function Placed({
  pop,
  windowWidth,
  windowHeight,
}: {
  pop: OpenPopover;
  windowWidth: number;
  windowHeight: number;
}): React.JSX.Element {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  // The menu's natural height, so it can open upwards when it would not fit below.
  const [content, setContent] = useState(0);
  const reveal = useRef(new Animated.Value(0)).current;
  const ready = size !== null && content > 0;
  useEffect(() => {
    if (!ready) {
      return;
    }
    Animated.timing(reveal, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeMotion,
    }).start();
  }, [ready, reveal]);
  const { anchor } = pop;
  const below = windowHeight - (anchor.y + anchor.height) - GAP - EDGE;
  const above = anchor.y - GAP - EDGE;
  const height = content + 2;
  // Opens downwards unless only the space above can hold it.
  const up = height > below && above > below;
  const maxHeight = Math.max(160, up ? above : below);
  const width = size?.width ?? pop.width ?? anchor.width;
  // The icon tray hangs centred under its button; menus line up with an edge.
  const rawLeft = pop.slim
    ? anchor.x + (anchor.width - width) / 2
    : pop.align === 'end'
    ? anchor.x + anchor.width - width
    : anchor.x;
  const gap = pop.slim ? 3 : GAP;
  const left = Math.max(EDGE, Math.min(rawLeft, windowWidth - width - EDGE));
  const top = up
    ? Math.max(EDGE, anchor.y - gap - Math.min(height, maxHeight))
    : anchor.y + anchor.height + gap;
  return (
    <Animated.View
      accessibilityViewIsModal
      onLayout={e => {
        const next = e.nativeEvent.layout;
        if (
          !size ||
          Math.abs(size.width - next.width) > 1 ||
          Math.abs(size.height - next.height) > 1
        ) {
          setSize({ width: next.width, height: next.height });
        }
      }}
      style={[
        styles.panel,
        pop.slim && styles.slimPanel,
        {
          left,
          top,
          minWidth: pop.slim
            ? anchor.width
            : Math.max(pop.width ?? 0, anchor.width, 200),
          maxHeight,
          opacity: ready ? reveal : 0,
          transform: [
            {
              translateY: reveal.interpolate({
                inputRange: [0, 1],
                outputRange: [up ? 8 : -8, 0],
              }),
            },
            {
              scale: reveal.interpolate({
                inputRange: [0, 1],
                outputRange: [0.96, 1],
              }),
            },
          ],
        },
      ]}
    >
      <ScrollView
        bounces={false}
        contentContainerStyle={pop.slim ? styles.slimScroll : styles.scroll}
        showsVerticalScrollIndicator={height > maxHeight}
        onContentSizeChange={(_w, h) => {
          if (Math.abs(h - content) > 1) {
            setContent(h);
          }
        }}
      >
        {pop.children}
      </ScrollView>
    </Animated.View>
  );
}

/** Mounted once beside the sheets; draws every open popover. */
export function PopoverHost({
  width,
  height,
}: {
  width: number;
  height: number;
}): React.JSX.Element | null {
  const dims = useWindowDimensions();
  const windowWidth = width || dims.width;
  const windowHeight = height || dims.height;
  const [, redraw] = useState(0);
  useEffect(() => subscribePopovers(() => redraw(value => value + 1)), []);
  if (!open.length) {
    return null;
  }
  return (
    <>
      {open.map(pop => (
        <View key={open.indexOf(pop)} style={styles.layer}>
          <Pressable
            {...noFocusRing}
            accessibilityLabel="Close menu"
            onPress={pop.onClose}
            style={StyleSheet.absoluteFill}
          />
          <Placed
            pop={pop}
            windowWidth={windowWidth}
            windowHeight={windowHeight}
          />
        </View>
      ))}
    </>
  );
}

/**
 * Shows children below the anchor while visible. The anchor is any view ref; it
 * is measured each time the popover opens.
 */
export function Popover({
  anchorRef,
  visible,
  onClose,
  align = 'start',
  width,
  slim = false,
  children,
}: {
  anchorRef: React.RefObject<View | null>;
  visible: boolean;
  onClose: () => void;
  align?: 'start' | 'end';
  width?: number;
  slim?: boolean;
  children: React.ReactNode;
}): null {
  const id = useRef({}).current;
  const [anchor, setAnchor] = useState<Frame | null>(null);
  useEscape(visible, onClose);
  useEffect(() => {
    if (!visible) {
      setAnchor(null);
      return;
    }
    const node = anchorRef.current;
    if (!node) {
      return;
    }
    node.measureInWindow((x, y, w, h) =>
      setAnchor({ x, y, width: w, height: h }),
    );
  }, [visible, anchorRef]);
  useEffect(() => {
    const present = open.some(pop => pop.id === id);
    if (!visible || !anchor) {
      if (present) {
        write(open.filter(pop => pop.id !== id));
      }
      return;
    }
    const entry = { id, anchor, align, width, slim, onClose, children };
    write(
      present
        ? open.map(pop => (pop.id === id ? entry : pop))
        : [...open, entry],
    );
  }, [id, visible, anchor, align, width, slim, onClose, children]);
  useEffect(
    () => () => {
      if (open.some(pop => pop.id === id)) {
        write(open.filter(pop => pop.id !== id));
      }
    },
    [id],
  );
  return null;
}

/** One row of a popover menu: icon, label, and a check for the current value. */
export function PopoverItem({
  label,
  icon,
  onPress,
  selected = false,
  danger = false,
  disabled = false,
  hint,
}: {
  label: string;
  icon?: IconName | undefined;
  onPress: () => void;
  selected?: boolean | undefined;
  danger?: boolean | undefined;
  disabled?: boolean | undefined;
  hint?: string | undefined;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const tint = disabled
    ? colors.muted
    : danger
    ? colors.danger
    : selected
    ? colors.accent
    : hover
    ? colors.mist
    : colors.chrome;
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={[
        styles.item,
        selected && styles.itemSelected,
        hover &&
          !disabled &&
          (danger ? styles.itemDangerHover : styles.itemHover),
        disabled && styles.itemDisabled,
      ]}
    >
      {icon && <Icon name={icon} size={16} color={tint} />}
      <Text
        numberOfLines={1}
        style={[
          styles.itemText,
          {
            color:
              danger || selected ? tint : hover ? colors.mist : colors.text,
          },
          selected && styles.itemTextSelected,
        ]}
      >
        {label}
      </Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {selected && <Icon name="check" size={14} color={colors.accent} />}
    </Pressable>
  );
}

export function PopoverDivider(): React.JSX.Element {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, zIndex: 30 },
  panel: {
    position: 'absolute',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#101C29',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
    overflow: 'hidden',
    maxWidth: 360,
  },
  scroll: { padding: 6, gap: 2 },
  slimPanel: { borderRadius: 999, backgroundColor: '#0A131DF2' },
  slimScroll: { paddingVertical: 3, gap: 1, alignItems: 'center' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  itemHover: { backgroundColor: colors.hover },
  itemDangerHover: { backgroundColor: '#3A2328' },
  itemSelected: { backgroundColor: colors.accentSoft },
  itemDisabled: { opacity: 0.5 },
  itemText: { flexGrow: 1, flexShrink: 0, fontFamily, fontSize: 14 },
  itemTextSelected: { fontWeight: '600' },
  hint: { fontFamily, fontSize: 12, color: colors.muted },
  divider: {
    height: 1,
    marginVertical: 4,
    marginHorizontal: 6,
    backgroundColor: colors.line,
  },
});
