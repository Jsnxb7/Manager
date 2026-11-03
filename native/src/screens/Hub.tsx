import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { Route } from '../app/routes';
import { coverUri } from '../components/Cover';
import { Button, Field, Sheet } from '../components/controls';
import { PanelPage } from '../components/Fade';
import { Icon, IconButton } from '../components/Icon';
import {
  colors,
  displayFamily,
  fontFamily,
  ui,
  noFocusRing,
} from '../design/theme';
import { useViewport } from '../design/viewport';

// Covers fan out like a hand of cards, with the first on top in the middle.
const FAN = [
  { left: 46, zIndex: 3, rotate: '0deg', top: 0 },
  { left: 6, zIndex: 2, rotate: '-7deg', top: 10 },
  { left: 86, zIndex: 1, rotate: '7deg', top: 10 },
];
// On hover the side covers spread further out and the front one lifts.
function fan(index: number, total: number, open: Animated.Value) {
  const place = total === 2 ? FAN[index === 0 ? 1 : 2]! : FAN[index]!;
  const side = place.left < 46 ? -1 : place.left > 46 ? 1 : 0;
  return {
    left: place.left,
    top: place.top,
    zIndex: place.zIndex,
    transform: [
      {
        translateX: open.interpolate({
          inputRange: [0, 1],
          outputRange: [0, side * 16],
        }),
      },
      {
        translateY: open.interpolate({
          inputRange: [0, 1],
          outputRange: [0, side ? 2 : -8],
        }),
      },
      {
        rotate: open.interpolate({
          inputRange: [0, 1],
          outputRange: [`${side * 7}deg`, `${side * 12}deg`],
        }),
      },
    ],
  };
}

const TILE_STEP = 224;

/**
 * Tiles travel slowly in an endless loop like train carriages. Hovering pauses
 * them; scrolling, touch or the arrows pause them for a few seconds.
 */
function Train({
  tiles,
  paused,
}: {
  tiles: (clone: boolean) => React.ReactNode[];
  paused: boolean;
}): React.JSX.Element {
  const list = useRef<ScrollView>(null);
  const offset = useRef(0);
  const expected = useRef(0);
  const holdUntil = useRef(0);
  const glidingUntil = useRef(0);
  const hovering = useRef(false);
  const stopped = useRef(paused);
  stopped.current = paused;
  const [viewWidth, setViewWidth] = useState(0);
  const count = tiles(true).length;
  const setWidth = count * TILE_STEP;
  const copies = viewWidth ? Math.ceil(viewWidth / setWidth) + 3 : 1;
  const place = (value: number, animated = false) => {
    offset.current = value;
    expected.current = value;
    list.current?.scrollTo({ x: value, animated });
  };
  useEffect(() => {
    if (viewWidth) {
      place(setWidth);
    }
  }, [viewWidth, setWidth]);
  useEffect(() => {
    let reduced = false;
    AccessibilityInfo.isReduceMotionEnabled?.().then(value => {
      reduced = value;
    });
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - last;
      last = now;
      if (
        reduced ||
        !viewWidth ||
        hovering.current ||
        stopped.current ||
        now < holdUntil.current
      ) {
        return;
      }
      const next = offset.current + (elapsed * 12) / 1000;
      place(next >= setWidth * 2 ? next - setWidth : next);
    }, 16);
    return () => clearInterval(timer);
  }, [viewWidth, setWidth]);
  const page = (direction: 1 | -1) => {
    holdUntil.current = Date.now() + 6000;
    glidingUntil.current = Date.now() + 600;
    const from =
      direction === 1
        ? offset.current >= setWidth * 2
          ? offset.current - setWidth
          : offset.current
        : offset.current < viewWidth
        ? offset.current + setWidth
        : offset.current;
    if (from !== offset.current) {
      place(from);
    }
    const pageStep = Math.max(
      TILE_STEP,
      Math.floor(viewWidth / TILE_STEP) * TILE_STEP,
    );
    place(from + direction * pageStep, true);
  };
  return (
    <Pressable
      {...noFocusRing}
      focusable={false}
      onHoverIn={() => {
        hovering.current = true;
      }}
      onHoverOut={() => {
        hovering.current = false;
      }}
      style={styles.trainRow}
    >
      <ScrollView
        ref={list}
        horizontal
        contentContainerStyle={styles.trainContent}
        showsHorizontalScrollIndicator={false}
        style={ui.grow}
        onLayout={e => setViewWidth(e.nativeEvent.layout.width)}
        onTouchStart={() => {
          holdUntil.current = Date.now() + 6000;
        }}
        scrollEventThrottle={16}
        onScroll={e => {
          const x = e.nativeEvent.contentOffset.x;
          if (Date.now() < glidingUntil.current) {
            offset.current = x;
            expected.current = x;
            return;
          }
          if (Math.abs(x - expected.current) > 3) {
            // The person scrolled it, so hand over control for a while.
            holdUntil.current = Date.now() + 6000;
            offset.current = x;
            expected.current = x;
            if (x >= setWidth * 2) {
              place(x - setWidth);
            } else if (x <= 0) {
              place(x + setWidth);
            }
          }
        }}
      >
        {Array.from({ length: copies }, (_, copy) => (
          <View key={copy} style={styles.trainSet}>
            {tiles(copy !== 0)}
          </View>
        ))}
      </ScrollView>
      <IconButton
        icon="back"
        label="Previous"
        solid
        style={styles.arrowLeft}
        onPress={() => page(-1)}
      />
      <IconButton
        icon="forward"
        label="Next"
        solid
        style={styles.arrowRight}
        onPress={() => page(1)}
      />
    </Pressable>
  );
}

function Tile({
  label,
  title,
  caption,
  covers,
  plus = false,
  clone,
  compact = false,
  onPress,
}: {
  clone: boolean;
  compact?: boolean;
  label: string;
  title: string;
  caption: string;
  covers: string[];
  plus?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const lit = hover || focus;
  const open = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(open, {
      toValue: lit ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [lit, open]);
  return (
    <Pressable
      {...noFocusRing}
      accessibilityRole="button"
      accessibilityLabel={clone ? undefined : label}
      accessibilityElementsHidden={clone}
      importantForAccessibility={clone ? 'no-hide-descendants' : 'auto'}
      focusable={!clone}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={compact ? styles.tileCompact : styles.tile}
    >
      {/* Phones show the same art at three quarters, centred in a smaller box. */}
      <View style={compact ? styles.artBox : undefined}>
        <View style={[styles.art, compact && styles.artCompact]}>
          {covers.map((uri, index) => (
            <Animated.Image
              key={uri}
              source={{ uri }}
              style={[
                styles.cover,
                fan(index, covers.length, open),
                lit && styles.coverLit,
              ]}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
          ))}
          {!plus && covers.length === 0 && (
            <Text style={styles.letter}>{title.slice(0, 1)}</Text>
          )}
          {plus && (
            <View style={[styles.plus, lit && styles.plusLit]}>
              <Icon
                name="plus"
                size={26}
                color={lit ? colors.background : colors.chrome}
              />
            </View>
          )}
        </View>
      </View>
      <View style={styles.copy}>
        <Text
          numberOfLines={1}
          style={[
            styles.title,
            compact && styles.titleCompact,
            lit && styles.titleLit,
          ]}
        >
          {title}
        </Text>
        <Text style={ui.muted}>{caption}</Text>
      </View>
    </Pressable>
  );
}

export function Hub({
  workspace: w,
  navigate,
}: {
  workspace: Workspace;
  navigate: (route: Route) => void;
}): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const { width } = useViewport();
  const create = () =>
    w.run(async () => {
      const title = name.trim();
      const slug = title.toLowerCase().replace(/\s+/g, '_');
      if (
        !/^[\p{L}\p{N}_-]+$/u.test(slug) ||
        [
          'queue',
          'player',
          'custom',
          'settings',
          'data',
          'static',
          'api',
        ].includes(slug)
      ) {
        throw new Error(
          'Use a section name containing letters, numbers, spaces or dashes.',
        );
      }
      await w.mutate(c => {
        if (c.sections.some(s => s.id === slug)) {
          throw new Error('This section already exists.');
        }
        c.sections.push({ id: slug, title, kind: 'custom' });
      });
      setName('');
      setAdding(false);
    }, 'Section created');
  return (
    <PanelPage center>
      <Text
        accessibilityRole="header"
        style={[styles.hero, width < 700 && styles.heroPhone]}
      >
        Content Hub
      </Text>
      {(() => {
        const tiles = (clone: boolean, compact = false) => [
          ...(w.catalog?.sections ?? []).map(section => {
            const entries = w.catalog!.entries.filter(
              e => e.sectionId === section.id,
            );
            const count = entries.length;
            return (
              <Tile
                key={section.id}
                clone={clone}
                label={`Browse ${section.title}`}
                title={section.title}
                caption={`${count} ${count === 1 ? 'title' : 'titles'}`}
                compact={compact}
                covers={entries
                  .filter(e => e.cover)
                  .slice(0, 3)
                  .map(e => coverUri(e, w.io?.privateRoot))}
                onPress={() =>
                  navigate({ name: 'library', sectionId: section.id })
                }
              />
            );
          }),
          <Tile
            key="add-section"
            clone={clone}
            label="Add section"
            title="Add section"
            caption="Start a new library"
            covers={[]}
            plus
            compact={compact}
            onPress={() => setAdding(true)}
          />,
        ];
        // A phone shows every section at once in a grid; wider windows keep the train.
        return width < 700 ? (
          <View style={styles.grid}>{tiles(false, true)}</View>
        ) : (
          <Train paused={adding} tiles={clone => tiles(clone)} />
        );
      })()}

      <Sheet
        title="Add content section"
        visible={adding}
        onClose={() => setAdding(false)}
      >
        <Field
          label="Section name"
          value={name}
          onChange={setName}
          placeholder="Movies, Drama, TV Shows…"
        />
        <Button
          label="Create section"
          primary
          disabled={w.busy}
          onPress={() => {
            create().catch(w.setError);
          }}
        />
      </Sheet>
    </PanelPage>
  );
}
const styles = StyleSheet.create({
  hero: {
    fontFamily: displayFamily,
    fontSize: 52,
    fontWeight: '700',
    letterSpacing: -1,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 0,
  },
  heroPhone: { fontFamily, fontSize: 36, letterSpacing: -0.5 },
  trainRow: { flexDirection: 'row', alignItems: 'center' },
  // Room for covers to spread and lift on hover without being cut off.
  trainContent: { paddingVertical: 28 },
  arrowLeft: { position: 'absolute', left: 12, zIndex: 2 },
  arrowRight: { position: 'absolute', right: 12, zIndex: 2 },
  trainSet: { flexDirection: 'row' },
  tile: { width: 200, marginRight: 24, alignItems: 'center' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: 28,
    paddingTop: 28,
    paddingHorizontal: 8,
  },
  tileCompact: { width: '50%', alignItems: 'center' },
  artBox: {
    width: 150,
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artCompact: { transform: [{ scale: 0.75 }] },
  titleCompact: { fontSize: 19 },
  art: {
    width: 200,
    height: 176,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cover: {
    position: 'absolute',
    width: 108,
    height: 158,
    borderRadius: 6,
    opacity: 0.92,
  },
  coverLit: { opacity: 1 },
  letter: {
    fontFamily: displayFamily,
    fontSize: 96,
    fontWeight: '300',
    color: colors.line,
  },
  plus: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.raised,
  },
  plusLit: { backgroundColor: colors.chrome },
  copy: { marginTop: 10, gap: 2, alignItems: 'center' },
  title: {
    fontFamily: displayFamily,
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: -0.5,
    color: colors.text,
  },
  titleLit: { fontFamily, color: colors.mist },
});
