import React, { useEffect, useRef, useState } from 'react';
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
import { Icon, IconButton } from './Icon';
import { colors, fontFamily, ui, noFocusRing } from '../design/theme';
export function Button({
  label,
  onPress,
  primary = false,
  danger = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
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
        primary && ui.primary,
        hover &&
          !disabled &&
          (primary ? styles.primaryHover : styles.buttonHover),
        disabled && ui.disabled,
        (pressed || focused) && ui.pressed,
      ]}
    >
      <Text
        style={[
          ui.buttonText,
          primary && ui.primaryText,
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

/** A row that highlights under the pointer. Press is optional for rows of inner controls. */
export function HoverRow({
  children,
  onPress,
  label,
  style,
}: {
  children: React.ReactNode | ((hover: boolean) => React.ReactNode);
  onPress?: () => void;
  label?: string;
  style?: StyleProp<ViewStyle>;
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
      style={[style, hover && styles.rowHover]}
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  numeric?: boolean;
  multiline?: boolean;
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
  const [open, setOpen] = useState(openSheets.length > 0);
  useEffect(() => {
    const listener = () => setOpen(openSheets.length > 0);
    hostListeners.add(listener);
    return () => {
      hostListeners.delete(listener);
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
}: {
  message: string;
  kind: 'error' | 'success';
  bottom: number;
  onDismiss?: () => void;
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
          name={error ? 'alert' : 'check'}
          size={18}
          color={error ? colors.danger : colors.success}
        />
        <Text selectable={error} style={[ui.text, styles.toastText]}>
          {message.replace(/^Error: /, '')}
        </Text>
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
          <View
            accessibilityViewIsModal
            style={
              sheet.drawer ? styles.drawer : [styles.sheet, styles.surface]
            }
          >
            <SheetBody sheet={sheet} />
          </View>
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
  return (
    <View style={[styles.field, row && styles.inlineRow]}>
      <Text style={ui.muted}>{label}</Text>
      {inline ? (
        <Pressable
          {...noFocusRing}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${display ?? value}`}
          onPress={() => setOpen(true)}
          onHoverIn={() => setHover(true)}
          onHoverOut={() => setHover(false)}
          style={[styles.inlineValue, hover && styles.inlineHover]}
        >
          <Text style={ui.text}>{display ?? value.replace('_', ' ')}</Text>
          <Icon name="down" size={12} color={colors.muted} />
        </Pressable>
      ) : (
        <Button label={value.replace('_', ' ')} onPress={() => setOpen(true)} />
      )}
      <Sheet title={label} visible={open} onClose={() => setOpen(false)}>
        {values.map(item => (
          <Button
            key={item}
            label={item.replace('_', ' ')}
            primary={item === value}
            onPress={() => {
              onChange(item);
              setOpen(false);
            }}
          />
        ))}
      </Sheet>
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
  buttonHover: { backgroundColor: colors.hover, borderColor: colors.hover },
  primaryHover: { backgroundColor: colors.accent, borderColor: colors.accent },
  rowHover: { backgroundColor: '#14212E' },
  textButton: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  textButtonActive: { backgroundColor: colors.accentSoft },
  textButtonText: { fontFamily, fontSize: 14, color: colors.muted },
  textButtonLit: { color: colors.text },
  textButtonActiveText: { color: colors.accent, fontWeight: '600' },
  inlineHover: { backgroundColor: colors.hover },
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
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.raised,
    overflow: 'hidden',
  },
  fill: { height: 3, backgroundColor: colors.chrome },
});
