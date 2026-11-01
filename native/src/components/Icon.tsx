import React, { useState } from 'react';
import {
  Image,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { colors, fontFamily, noFocusRing } from '../design/theme';

const glyphs = {
  back: require('../assets/icons/back.webp'),
  forward: require('../assets/icons/forward.webp'),
  up: require('../assets/icons/up.webp'),
  edit: require('../assets/icons/edit.webp'),
  top: require('../assets/icons/top.webp'),
  alert: require('../assets/icons/alert.webp'),
  down: require('../assets/icons/down.webp'),
  pause: require('../assets/icons/pause.webp'),
  fullscreen: require('../assets/icons/fullscreen.webp'),
  volume: require('../assets/icons/volume.webp'),
  mute: require('../assets/icons/mute.webp'),
  captions: require('../assets/icons/captions.webp'),
  home: require('../assets/icons/home.webp'),
  play: require('../assets/icons/play.webp'),
  queue: require('../assets/icons/queue.webp'),
  search: require('../assets/icons/search.webp'),
  filter: require('../assets/icons/filter.webp'),
  settings: require('../assets/icons/settings.webp'),
  plus: require('../assets/icons/plus.webp'),
  check: require('../assets/icons/check.webp'),
  close: require('../assets/icons/close.webp'),
  bookmark: require('../assets/icons/bookmark.webp'),
  bookmarkFilled: require('../assets/icons/bookmark-filled.webp'),
  trash: require('../assets/icons/trash.webp'),
  grid: require('../assets/icons/grid.webp'),
  list: require('../assets/icons/list.webp'),
  tag: require('../assets/icons/tag.webp'),
  link: require('../assets/icons/link.webp'),
  reset: require('../assets/icons/reset.webp'),
  folder: require('../assets/icons/folder.webp'),
  player: require('../assets/icons/player.webp'),
  more: require('../assets/icons/more.webp'),
} as const;
export type IconName = keyof typeof glyphs;

export function Icon({
  name,
  size = 20,
  color = colors.text,
}: {
  name: IconName;
  size?: number;
  color?: string;
}): React.JSX.Element {
  return (
    <Image
      source={glyphs[name]}
      style={{ width: size, height: size, tintColor: color }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/** A bare icon control. Shape only appears on hover or focus, so bars stay free of boxes. */
export function IconButton({
  icon,
  label,
  onPress,
  active = false,
  badge,
  size = 20,
  color,
  solid = false,
  disabled = false,
  style,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  badge?: number;
  size?: number;
  color?: string;
  solid?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  // Even the smallest icons stay comfortable to hit.
  const pad = Math.max(8, Math.round(size * 0.45));
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...{ tooltip: label }}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={[
        styles.button,
        { padding: pad, borderRadius: size + pad },
        solid && styles.solid,
        active && styles.active,
        hover && !disabled && styles.hover,
        focus && styles.focus,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Icon
        name={icon}
        size={size}
        color={color ?? (active ? colors.accent : colors.text)}
      />
      {badge !== undefined && badge > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  solid: { backgroundColor: '#0A131DCC' },
  active: { backgroundColor: colors.accentSoft },
  hover: { backgroundColor: colors.hover },
  focus: { borderColor: colors.line },
  disabled: { opacity: 0.4 },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chrome,
  },
  badgeText: {
    fontFamily,
    fontSize: 10,
    fontWeight: '700',
    color: colors.background,
  },
});
