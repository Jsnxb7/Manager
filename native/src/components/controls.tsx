import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  Text,
  TextInput,
  View,
  ViewStyle,
  StyleSheet,
} from 'react-native';
import { Icon, IconButton, IconName } from './Icon';
import { useEscape } from '../app/keys';
import { Reveal } from './Motion';
import {
  Popover,
  PopoverItem,
  popoverCount,
  subscribePopovers,
} from './Popover';
import { colors, fontFamily, ui, noFocusRing } from '../design/theme';
export function Button({
  label,
  onPress,
  primary = false,
  danger = false,
  success = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  /** A completed state, shown in green. */
  success?: boolean;
  disabled?: boolean;
}): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        ui.button,
        primary && !success && ui.primary,
        success && styles.success,
        hover &&
          !disabled &&
          (success
            ? styles.successHover
            : primary
            ? styles.primaryHover
            : styles.buttonHover),
        disabled && ui.disabled,
        (pressed || focused) && ui.pressed,
      ]}
    >
      <Text
        style={[
          ui.buttonText,
          primary && !success && ui.primaryText,
          success && styles.successText,
          danger && ui.dangerText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
/** Quiet text control: highlights on hover, and turns blue while selected. */
export function TextButton({
  label,
  onPress,
  active = false,
  danger = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={[
        styles.textButton,
        active && styles.textButtonActive,
        hover && !disabled && styles.buttonHover,
        disabled && ui.disabled,
      ]}
    >
      <Text
        style={[
          styles.textButtonText,
          (hover || active) && styles.textButtonLit,
          active && styles.textButtonActiveText,
          danger && ui.dangerText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A rounded icon-and-label control for secondary actions beside headings. */
export function ChipButton({
  icon,
  label,
  onPress,
  primary = false,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const lit = hover && !disabled;
  const tint = primary ? colors.background : lit ? colors.mist : colors.chrome;
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={({ pressed }) => [
        styles.chip,
        primary && styles.chipPrimary,
        lit && (primary ? styles.chipPrimaryHover : styles.buttonHover),
        pressed && ui.pressed,
        disabled && ui.disabled,
      ]}
    >
      <Icon name={icon} size={14} color={tint} />
      <Text style={[styles.chipText, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

/** A row that highlights under the pointer. Press is optional for rows of inner controls. */
export function HoverRow({
  children,
  onPress,
  label,
  style,
  hoverStyle,
}: {
  children: React.ReactNode | ((hover: boolean) => React.ReactNode);
  onPress?: () => void;
  label?: string;
  style?: StyleProp<ViewStyle>;
  hoverStyle?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      focusable={!!onPress}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={[style, hover && (hoverStyle ?? styles.rowHover)]}
    >
      {typeof children === 'function' ? children(hover) : children}
    </Pressable>
  );
}
export function Field({
  label,
  value,
  onChange,
  placeholder = '',
  numeric = false,
  multiline = false,
  onSubmit,
  onKey,
  onFocusChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  numeric?: boolean;
  multiline?: boolean;
  /** Enter in a one-line field; the field keeps focus for the next entry. */
  onSubmit?: () => void;
  /** Keys pressed in the field, such as arrows to move through suggestions. */
  onKey?: (key: string) => void;
  onFocusChange?: (focused: boolean) => void;
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={ui.muted}>{label}</Text>
      <TextInput
        {...noFocusRing}
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={ui.input}
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? 'number-pad' : 'default'}
        multiline={multiline}
        onSubmitEditing={onSubmit}
        blurOnSubmit={onSubmit ? false : undefined}
        onKeyPress={onKey ? e => onKey(e.nativeEvent.key) : undefined}
        onFocus={onFocusChange ? () => onFocusChange(true) : undefined}
        onBlur={onFocusChange ? () => onFocusChange(false) : undefined}
      />
    </View>
  );
}
type OpenSheet = {
  id: object;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  drawer: boolean;
};
let openSheets: OpenSheet[] = [];
let hostMounted = false;
const hostListeners = new Set<() => void>();
function writeSheets(next: OpenSheet[]): void {
  openSheets = next;
  hostListeners.forEach(listener => listener());
}

/** True while any sheet is open; native views must hide or they cover it. */
export function useSheetOpen(): boolean {
  const covered = () => openSheets.length > 0 || popoverCount() > 0;
  const [open, setOpen] = useState(covered);
  useEffect(() => {
    const listener = () => setOpen(covered());
    hostListeners.add(listener);
    const unsubscribe = subscribePopovers(listener);
    return () => {
      hostListeners.delete(listener);
      unsubscribe();
    };
  }, []);
  return open;
}

function SheetBody({
  sheet,
}: {
  sheet: Omit<OpenSheet, 'id'>;
}): React.JSX.Element {
  return (
    <>
      <View style={ui.row}>
        <Text accessibilityRole="header" style={[ui.subheading, ui.grow]}>
          {sheet.title}
        </Text>
        <IconButton icon="close" label="Close" onPress={sheet.onClose} />
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {sheet.children}
      </ScrollView>
    </>
  );
}

/** Floating confirmation or error. Errors stay until dismissed; notices time out. */
export function Toast({
  message,
  kind,
  bottom,
  onDismiss,
  action,
  icon,
}: {
  message: string;
  kind: 'error' | 'success';
  bottom: number;
  onDismiss?: () => void;
  /** A button inside the toast, such as "Sync now". */
  action?: { label: string; onPress: () => void };
  icon?: IconName;
}): React.JSX.Element {
  const error = kind === 'error';
  return (
    <View pointerEvents="box-none" style={[styles.toastLayer, { bottom }]}>
      <View
        accessibilityRole={error ? 'alert' : undefined}
        accessibilityLiveRegion="polite"
        style={styles.toast}
      >
        <Icon
          name={icon ?? (error ? 'alert' : 'check')}
          size={18}
          color={error ? colors.danger : colors.success}
        />
        <Text selectable={error} style={[ui.text, styles.toastText]}>
          {message.replace(/^Error: /, '')}
        </Text>
        {action && <TextButton label={action.label} onPress={action.onPress} />}
        {onDismiss && (
          <IconButton
            icon="close"
            label="Dismiss"
            size={12}
            onPress={onDismiss}
          />
        )}
      </View>
    </View>
  );
}

/**
 * Draws open sheets over the whole window. React Native Windows opens Modal as a
 * small separate OS window, so sheets render here instead.
 */
export function SheetHost(): React.JSX.Element | null {
  hostMounted = true;
  const [, redraw] = useState(0);
  useEffect(() => {
    const listener = () => redraw(value => value + 1);
    hostListeners.add(listener);
    return () => {
      hostListeners.delete(listener);
      hostMounted = false;
    };
  }, []);
  if (!openSheets.length) {
    return null;
  }
  return (
    <>
      {openSheets.map(sheet => (
        <View
          key={openSheets.indexOf(sheet)}
          style={[styles.overlay, sheet.drawer && styles.overlayDrawer]}
        >
          <Pressable
            {...noFocusRing}
            accessibilityLabel="Close"
            onPress={sheet.onClose}
            style={StyleSheet.absoluteFill}
          />
          <Reveal
            id="sheet"
            direction={sheet.drawer ? 1 : 0}
            distance={sheet.drawer ? 64 : 28}
            duration={280}
            style={
              sheet.drawer ? styles.drawer : [styles.sheet, styles.surface]
            }
          >
            <View accessibilityViewIsModal style={styles.sheetInner}>
              <SheetBody sheet={sheet} />
            </View>
          </Reveal>
        </View>
      ))}
    </>
  );
}

export function Sheet({
  title,
  visible,
  onClose,
  children,
  drawer = false,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  drawer?: boolean;
}): React.JSX.Element | null {
  const id = useRef({}).current;
  useEscape(visible, onClose);
  useEffect(() => {
    if (!hostMounted) {
      return;
    }
    const present = openSheets.some(sheet => sheet.id === id);
    if (!visible) {
      if (present) {
        writeSheets(openSheets.filter(sheet => sheet.id !== id));
      }
      return;
    }
    const entry = { id, title, onClose, children, drawer };
    writeSheets(
      present
        ? openSheets.map(sheet => (sheet.id === id ? entry : sheet))
        : [...openSheets, entry],
    );
  }, [id, visible, title, onClose, children, drawer]);
  useEffect(
    () => () => {
      if (openSheets.some(sheet => sheet.id === id)) {
        writeSheets(openSheets.filter(sheet => sheet.id !== id));
      }
    },
    [id],
  );
  if (hostMounted) {
    return null;
  }
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.scrim}>
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={ui.row}>
            <Text accessibilityRole="header" style={[ui.subheading, ui.grow]}>
              {title}
            </Text>
            <Button label="Close" onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.body}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
export function ProgressBar({
  value,
  label,
}: {
  value: number;
  label: string;
}): React.JSX.Element {
  const width = `${Math.min(100, Math.max(0, value))}%` as `${number}%`;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value) }}
      style={styles.track}
    >
      <View style={[styles.fill, { width }]} />
    </View>
  );
}
/** A dropdown: the current value, and its options in a menu right beneath it. */
export function Choice({
  label,
  values,
  value,
  onChange,
  inline = false,
  display,
  row = false,
}: {
  inline?: boolean;
  row?: boolean;
  display?: string;
  label: string;
  values: readonly string[];
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const anchor = useRef<View | null>(null);
  const shown = display ?? value.replace('_', ' ');
  const close = useCallback(() => setOpen(false), []);
  return (
    <View style={[styles.field, row && styles.inlineRow]}>
      <Text style={ui.muted}>{label}</Text>
      <Pressable
        {...noFocusRing}
        ref={anchor}
        accessibilityRole="combobox"
        accessibilityLabel={`${label}: ${shown}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(isOpen => !isOpen)}
        onHoverIn={() => setHover(true)}
        onHoverOut={() => setHover(false)}
        style={[
          inline ? styles.inlineValue : styles.select,
          (hover || open) && (inline ? styles.inlineHover : styles.selectLit),
        ]}
      >
        <Text style={[ui.text, !inline && styles.selectText]} numberOfLines={1}>
          {shown}
        </Text>
        <Icon
          name={open ? 'up' : 'down'}
          size={12}
          color={open ? colors.accent : colors.muted}
        />
      </Pressable>
      <Popover anchorRef={anchor} visible={open} onClose={close}>
        {values.map(item => (
          <PopoverItem
            key={item}
            label={item.replace('_', ' ')}
            selected={item === value}
            onPress={() => {
              setOpen(false);
              if (item !== value) {
                onChange(item);
              }
            }}
          />
        ))}
      </Popover>
    </View>
  );
}
const styles = StyleSheet.create({
  field: { gap: 6 },
  scrim: {
    flex: 1,
    backgroundColor: '#060C14D9',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
    backgroundColor: '#060C14D9',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  surface: { backgroundColor: colors.panel, borderRadius: 12 },
  buttonHover: { backgroundColor: colors.hover, borderColor: colors.accent },
  success: {
    backgroundColor: colors.successSoft,
    borderColor: colors.successLine,
  },
  successHover: { backgroundColor: '#22402F', borderColor: colors.success },
  successText: { color: colors.success },
  primaryHover: { backgroundColor: colors.accent, borderColor: colors.accent },
  rowHover: { backgroundColor: colors.rowHover },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.raised,
  },
  chipPrimary: { backgroundColor: colors.chrome, borderColor: colors.chrome },
  chipPrimaryHover: { backgroundColor: colors.mist, borderColor: colors.mist },
  chipText: { fontFamily, fontSize: 13, fontWeight: '600' },
  textButton: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  textButtonActive: { backgroundColor: colors.accentSoft },
  textButtonText: { fontFamily, fontSize: 14, color: colors.muted },
  textButtonLit: { color: colors.text },
  textButtonActiveText: { color: colors.accent, fontWeight: '600' },
  inlineHover: { backgroundColor: colors.hover },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.raised,
    alignSelf: 'flex-start',
    minWidth: 180,
  },
  selectLit: { borderColor: colors.accent, backgroundColor: colors.hover },
  selectText: { flex: 1, fontSize: 15 },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inlineValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 32,
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  toastLayer: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 20,
    alignItems: 'center',
  },
  toast: {
    maxWidth: 560,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 16,
    paddingRight: 10,
    paddingVertical: 10,
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: colors.raised,
  },
  toastText: { flexShrink: 1, fontSize: 14, lineHeight: 20 },
  overlayDrawer: {
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    padding: 0,
  },
  drawer: {
    width: '100%',
    maxWidth: 480,
    height: '100%',
    // Clears the window's caption buttons on Windows.
    paddingTop: Platform.OS === 'windows' ? 48 : 20,
    paddingHorizontal: 20,
    gap: 20,
    backgroundColor: colors.panel,
  },
  sheet: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '90%',
    padding: 20,
    gap: 20,
  },
  body: { gap: 14, paddingBottom: 16 },
  sheetInner: { flexShrink: 1, gap: 20 },
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.raised,
    overflow: 'hidden',
  },
  fill: { height: 3, backgroundColor: colors.chrome },
});
