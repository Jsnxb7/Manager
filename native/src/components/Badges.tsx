import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { colors, fontFamily, noFocusRing } from '../design/theme';

/** "★ 8" on a cover (`overlay`) or beside text (`inline`). */
export function RatingBadge({
  rating,
  overlay = false,
}: {
  rating: number | null;
  overlay?: boolean;
}): React.JSX.Element | null {
  if (!rating) {
    return null;
  }
  return (
    <View
      accessibilityLabel={`Rated ${rating} out of 10`}
      style={[styles.rating, overlay && styles.pill]}
    >
      <Icon name="starFilled" size={12} color={colors.accent} />
      <Text style={styles.ratingText}>{rating}</Text>
    </View>
  );
}

/** "+3 new" when a title's folder holds episodes it does not list yet. */
export function NewBadge({
  count,
  overlay = false,
}: {
  count: number;
  overlay?: boolean;
}): React.JSX.Element | null {
  if (!count) {
    return null;
  }
  return (
    <View
      accessibilityLabel={`${count} new episode file${
        count === 1 ? '' : 's'
      } found`}
      style={[styles.fresh, overlay && styles.freshOverlay]}
    >
      <Text style={styles.freshText}>+{count} new</Text>
    </View>
  );
}

/**
 * A personal score from 1 to 10 as one segmented bar: cells fill up to the score.
 * Pressing the current score clears it.
 */
/** MyAnimeList's words for each score, so a number reads as a verdict. */
const VERDICTS = [
  '',
  'Appalling',
  'Horrible',
  'Very bad',
  'Bad',
  'Average',
  'Fine',
  'Good',
  'Very good',
  'Great',
  'Masterpiece',
];

/**
 * Ten slim segments that fill from the left, with the score and its verdict
 * beside them. Hovering previews a score; the clear button removes it.
 */
export function RatingScale({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  const previewing = hover !== null && hover !== value;
  return (
    <View style={styles.scaleWrap}>
      <View style={styles.scaleHead}>
        {shown > 0 && (
          <>
            <Text style={styles.score}>{shown}</Text>
            <Text style={styles.outOf}>/ 10</Text>
          </>
        )}
        <Text
          style={[
            styles.verdict,
            !shown && styles.verdictEmpty,
            previewing && styles.verdictPreview,
          ]}
          numberOfLines={1}
        >
          {shown ? VERDICTS[shown] : 'Not rated yet'}
        </Text>
        {value !== null && (
          <Pressable
            {...noFocusRing}
            accessibilityRole="button"
            accessibilityLabel="Clear rating"
            onPress={() => onChange(null)}
            style={({ pressed }) => [styles.clear, pressed && styles.clearOn]}
          >
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        )}
      </View>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel="Your rating"
        accessibilityValue={{
          min: 0,
          max: 10,
          now: value ?? 0,
          text: value ? `${value} out of 10` : 'Not rated',
        }}
        style={styles.scale}
      >
        {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
          <Pressable
            key={n}
            {...noFocusRing}
            accessibilityRole="button"
            accessibilityLabel={`Rate ${n} out of 10, ${VERDICTS[n]}`}
            onHoverIn={() => setHover(n)}
            onHoverOut={() => setHover(h => (h === n ? null : h))}
            onPress={() => onChange(n)}
            style={styles.hit}
          >
            <View
              style={[
                styles.segment,
                n <= shown && styles.segmentOn,
                n <= shown && {
                  opacity: 0.45 + (0.55 * n) / Math.max(shown, 1),
                },
                previewing && n <= shown && styles.segmentPreview,
                n === shown && styles.segmentTop,
              ]}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#0A131DE6',
    borderWidth: 1,
    borderColor: colors.line,
  },
  ratingText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: colors.mist,
  },
  fresh: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  freshOverlay: { backgroundColor: '#1E3A52F2' },
  freshText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent,
  },
  scaleWrap: { gap: 2, maxWidth: 420 },
  // Windows ignores baseline alignment, so the row sits on the bottom edge and
  // the smaller texts carry matching line heights.
  scaleHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    minHeight: 36,
  },
  score: {
    fontFamily,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '700',
    color: colors.mist,
  },
  outOf: {
    fontFamily,
    fontSize: 14,
    lineHeight: 18,
    paddingBottom: 4,
    color: colors.muted,
  },
  verdict: {
    flex: 1,
    marginLeft: 10,
    paddingBottom: 4,
    fontFamily,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.accent,
  },
  verdictPreview: { color: colors.text },
  verdictEmpty: { marginLeft: 0, color: colors.muted, fontWeight: '400' },
  clear: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
  },
  clearOn: { borderColor: colors.accent },
  clearText: { fontFamily, fontSize: 12, color: colors.muted },
  scale: { flexDirection: 'row', gap: 5 },
  hit: { flex: 1, paddingVertical: 8 },
  segment: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.raised,
  },
  segmentOn: { backgroundColor: colors.accent },
  segmentTop: { backgroundColor: colors.mist },
  segmentPreview: { backgroundColor: colors.chrome },
});
