import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  StyleSheet,
} from 'react-native';
import { colors, ui } from '../design/theme';
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        ui.button,
        primary && ui.primary,
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
export function Sheet({
  title,
  visible,
  onClose,
  children,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
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
}: {
  label: string;
  values: readonly string[];
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={ui.muted}>{label}</Text>
      <Button label={`${value} · Change`} onPress={() => setOpen(true)} />
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
    backgroundColor: '#000000B3',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  sheet: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '90%',
    backgroundColor: colors.panel,
    borderRadius: 16,
    padding: 20,
    gap: 16,
  },
  body: { gap: 12, paddingBottom: 16 },
  track: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.raised,
    overflow: 'hidden',
  },
  fill: { height: 5, backgroundColor: colors.chrome },
});
