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
import { regular, small } from './iconAssets';

export type IconName = keyof typeof regular;

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
      // Phosphor glyphs pre-rendered per display scale; small icons use the bold cut.
      source={(size <= 16 ? small : regular)[name]}
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
  const lit = hover && !disabled;
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
        lit && (color === colors.danger ? styles.hoverDanger : styles.hover),
        focus && styles.focus,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Icon
        name={icon}
        size={size}
        color={
          color ?? (active ? colors.accent : lit ? colors.mist : colors.text)
        }
      />
      {/* The current page is marked like the text tabs: a short blue underline. */}
      {active && !lit && <View style={styles.activeLine} />}
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
  solid: { backgroundColor: '#0A131DE0', borderColor: '#FFFFFF1F' },
  activeLine: {
    position: 'absolute',
    bottom: 2,
    alignSelf: 'center',
    width: 14,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.accent,
  },
  // Hover is a lit blue disc with an accent rim; the selected page keeps a softer
  // blue disc, so the two never read the same.
  hover: { backgroundColor: colors.hover, borderColor: colors.accent },
  hoverDanger: { backgroundColor: '#3A2226', borderColor: colors.danger },
  focus: { borderColor: colors.line },
  disabled: { opacity: 0.4 },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    // Blue count with a rim in the bar's colour, so it sits apart from the icon.
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.background,
  },
  badgeText: {
    fontFamily,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
    color: colors.background,
  },
});
