import { Platform, StyleSheet } from 'react-native';
export const colors = {
  // Night blue sampled from the shadowed foothills of the mountain background.
  background: '#0A131D',
  panel: '#0A131D',
  raised: '#1D2B3A',
  line: '#2A3A4B',
  chrome: '#C9CFD5',
  mist: '#F1F3F5',
  // Hovered controls, then selected ones: the blue of the distant ridges.
  hover: '#25364A',
  accent: '#86B8DC',
  accentSoft: '#1E3A52',
  // Ash for main text, charcoal-grey for secondary text.
  text: '#D6DADF',
  muted: '#8B9299',
  danger: '#E39E98',
  success: '#A3C4AF',
} as const;
// Bahnschrift's engineered DIN shapes suit the steel-and-ash look and ship with Windows.
export const fontFamily =
  Platform.OS === 'windows' ? 'Bahnschrift' : 'sans-serif-condensed';
export const displayFamily = fontFamily;
// Windows draws a heavy white ring on focus; controls show focus with their own colours.
export const noFocusRing = { enableFocusRing: false } as object;
export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  page: { padding: 24, gap: 16, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  heading: {
    fontFamily: displayFamily,
    fontSize: 34,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.5,
  },
  subheading: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  text: { fontFamily, fontSize: 16, lineHeight: 23, color: colors.text },
  muted: { fontFamily, fontSize: 14, lineHeight: 21, color: colors.muted },
  card: { gap: 12 },
  input: {
    fontFamily,
    minHeight: 44,
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 2,
    color: colors.text,
    fontSize: 16,
  },
  grow: { flex: 1 },
  thumbnail: { width: 72 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 21 },
  button: {
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.raised,
  },
  primary: { backgroundColor: colors.chrome, borderColor: colors.chrome },
  buttonText: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  primaryText: { color: colors.background },
  dangerText: { color: colors.danger },
  disabled: { opacity: 0.45 },
  pressed: { borderColor: colors.accent },
  small: { fontFamily, fontSize: 12, color: colors.muted },
  rule: { height: 1, backgroundColor: colors.line },
  empty: { paddingVertical: 40, gap: 12, alignItems: 'flex-start' },
});
