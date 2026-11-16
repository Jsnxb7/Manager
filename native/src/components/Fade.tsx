/* eslint-disable react-native/no-inline-styles -- fade geometry is computed from props */
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Image,
  ImageSourcePropType,
  Platform,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { colors } from '../design/theme';
import { useViewport } from '../design/viewport';

const ramp = {
  left: require('../assets/fade/left.webp'),
  right: require('../assets/fade/right.webp'),
  top: require('../assets/fade/top.webp'),
  bottom: require('../assets/fade/bottom.webp'),
  topLeft: require('../assets/fade/top-left.webp'),
  topRight: require('../assets/fade/top-right.webp'),
  bottomLeft: require('../assets/fade/bottom-left.webp'),
  bottomRight: require('../assets/fade/bottom-right.webp'),
} as const;

function Slice({
  source,
  style,
}: {
  source: ImageSourcePropType;
  style: ViewStyle;
}): React.JSX.Element {
  return (
    // Bundled images carry their intrinsic size, which would override edge
    // anchors, so the wrapper owns the geometry.
    <View style={[styles.slice, style]}>
      <Image
        source={source}
        resizeMode="stretch"
        style={styles.fill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </View>
  );
}

/**
 * Melts artwork into the panel on one side only: solid panel at that outer edge,
 * untouched art at the opposite edge. The Player's side covers use it.
 */
export function OuterFade({
  side,
}: {
  side: 'left' | 'right';
}): React.JSX.Element {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Slice
        source={side === 'left' ? ramp.right : ramp.left}
        style={{ top: 0, bottom: 0, width: '80%', [side]: 0 }}
      />
    </View>
  );
}

/** Names the page in the navigation history, so its scroll position can be kept. */
export const PageMemoryContext = createContext('');
const pageScroll = new Map<string, number>();
/** Drops remembered positions for history entries that no longer exist. */
export function forgetPages(keep: (key: string) => boolean): void {
  for (const key of [...pageScroll.keys()]) {
    if (!keep(key)) {
      pageScroll.delete(key);
    }
  }
}

// Page state that outlives a remount of the same page (a window resize re-renders
// some pages from scratch on Windows) but not a visit: Root clears it whenever the
// current history entry changes, so coming Back opens the page fresh.
const pageState = new Map<string, unknown>();
export function clearPageState(): void {
  pageState.clear();
}
/** useState that survives a remount of the current page. */
export function usePageState<T>(
  name: string,
  initial: T | (() => T),
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const memoryKey = useContext(PageMemoryContext);
  const key = `${memoryKey}|${name}`;
  const [value, setValue] = useState<T>(() =>
    memoryKey && pageState.has(key)
      ? (pageState.get(key) as T)
      : typeof initial === 'function'
      ? (initial as () => T)()
      : initial,
  );
  useEffect(() => {
    if (memoryKey) {
      pageState.set(key, value);
    }
  }, [key, memoryKey, value]);
  return [value, setValue];
}

const scrollListeners = new Set<(y: number) => void>();
const reportScroll = (y: number) => scrollListeners.forEach(fn => fn(y));
export function subscribeScroll(listener: (y: number) => void): () => void {
  scrollListeners.add(listener);
  return () => {
    scrollListeners.delete(listener);
  };
}

/**
 * Sits over the top bar's image. As a page scrolls, the panel's fade rises into
 * the bar and softens the edge below it, so content melts away under the bar.
 */
export function BarFade({ height }: { height: number }): React.JSX.Element {
  const [opacity, setOpacity] = useState(0);
  useEffect(() => {
    const listener = (y: number) =>
      setOpacity(Math.round(Math.min(1, Math.max(0, y / 80)) * 20) / 20);
    scrollListeners.add(listener);
    return () => {
      scrollListeners.delete(listener);
    };
  }, []);
  return (
    <View
      pointerEvents="none"
      style={[styles.barFade, { height: height + 32, opacity }]}
    >
      <Slice source={ramp.top} style={{ top: 0, left: 0, right: 0, height }} />
      <Slice
        source={ramp.bottom}
        style={{ top: height, left: 0, right: 0, height: 32 }}
      />
    </View>
  );
}

/** The solid surface content pages sit on. It melts into the background at the top. */
export function FadePanel({
  children,
  x = 88,
  top = 56,
  bottom = 120,
  pad = 8,
  style,
  onLayout,
}: {
  onLayout?: (height: number) => void;
  children: React.ReactNode;
  x?: number;
  top?: number;
  bottom?: number;
  pad?: number;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return (
    <View
      onLayout={e => onLayout?.(e.nativeEvent.layout.height)}
      style={[{ paddingHorizontal: x + pad }, style]}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Slice
          source={ramp.topLeft}
          style={{ top: 0, left: 0, width: x, height: top }}
        />
        <Slice
          source={ramp.top}
          style={{ top: 0, left: x, right: x, height: top }}
        />
        <Slice
          source={ramp.topRight}
          style={{ top: 0, right: 0, width: x, height: top }}
        />
        <Slice source={ramp.left} style={{ top, bottom, left: 0, width: x }} />
        <View
          style={[
            styles.slice,
            styles.body,
            { top, bottom, left: x, right: x },
          ]}
        />
        <Slice
          source={ramp.right}
          style={{ top, bottom, right: 0, width: x }}
        />
        <Slice
          source={ramp.bottomLeft}
          style={{ bottom: 0, left: 0, width: x, height: bottom }}
        />
        <Slice
          source={ramp.bottom}
          style={{ bottom: 0, left: x, right: x, height: bottom }}
        />
        <Slice
          source={ramp.bottomRight}
          style={{ bottom: 0, right: 0, width: x, height: bottom }}
        />
      </View>
      {children}
    </View>
  );
}

/** Scrolling page: the panel grows with its content, then fades just past the end. */
export function PanelPage({
  children,
  scrollRef,
  center = false,
  width: maxWidth,
  flush = false,
  pinTop = false,
  onScrollY,
  onRefresh,
}: {
  onScrollY?: (y: number) => void;
  /** Pull down at the top to run this (Android only; PC has a refresh button). */
  onRefresh?: (() => Promise<unknown>) | undefined;
  /** Holds the page at its top while it opens (the Player). */
  pinTop?: boolean;
  children: React.ReactNode;
  scrollRef?: React.Ref<ScrollView>;
  center?: boolean;
  flush?: boolean;
  width?: number;
}): React.JSX.Element {
  const { width } = useViewport();
  const phone = width < 700;
  const memoryKey = useContext(PageMemoryContext);
  const own = useRef<ScrollView | null>(null);
  const setRef = (node: ScrollView | null) => {
    own.current = node;
    if (typeof scrollRef === 'function') {
      scrollRef(node);
    } else if (scrollRef) {
      (scrollRef as React.MutableRefObject<ScrollView | null>).current = node;
    }
  };
  const opened = useRef(Date.now());
  // A page comes back where it was left: after Back, and after a window resize,
  // which re-renders some pages from scratch. Otherwise it starts at the top.
  useEffect(() => {
    const saved = memoryKey ? pageScroll.get(memoryKey) ?? 0 : 0;
    reportScroll(saved);
    if (!saved) {
      return;
    }
    const timer = setTimeout(
      () => own.current?.scrollTo({ y: saved, animated: false }),
      60,
    );
    return () => clearTimeout(timer);
  }, [memoryKey]);
  // The Hub rests on the window bottom and only scrolls if it cannot fit.
  const [viewHeight, setViewHeight] = useState(0);
  const [panelHeight, setPanelHeight] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pull =
    onRefresh && Platform.OS === 'android' ? (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          onRefresh().finally(() => setRefreshing(false));
        }}
        colors={[colors.accent]}
        tintColor={colors.accent}
        progressBackgroundColor={colors.raised}
      />
    ) : undefined;
  return (
    <ScrollView
      ref={setRef}
      refreshControl={pull}
      contentContainerStyle={
        center ? [styles.hubPage, { minHeight: viewHeight }] : styles.page
      }
      scrollEnabled={!center || panelHeight > viewHeight}
      onLayout={e => setViewHeight(e.nativeEvent.layout.height)}
      scrollEventThrottle={16}
      onScroll={e => {
        const y = e.nativeEvent.contentOffset.y;
        // While a pinned page opens, focus moving onto a control lower down must
        // not carry the page past its heading.
        if (pinTop && y > 0 && Date.now() - opened.current < 900) {
          own.current?.scrollTo({ y: 0, animated: false });
          return;
        }
        if (memoryKey) {
          pageScroll.set(memoryKey, y);
        }
        reportScroll(y);
        onScrollY?.(y);
      }}
    >
      {/* Windows lets a scroll overshoot its end; the panel continues below the
          page so the overshoot never reveals the background under it. */}
      <View pointerEvents="none" style={styles.overpan} />
      {center ? (
        // The Hub's panel rests on the window bottom, with the mountains above it.
        <FadePanel
          onLayout={setPanelHeight}
          x={0}
          top={phone ? 110 : 170}
          bottom={0}
          pad={0}
          style={[
            styles.bottomPanel,
            {
              paddingTop: phone ? 70 : 110,
              // Keeps the Hub a little below the middle of the window.
              paddingBottom: Math.max(28, viewHeight * 0.13),
            },
          ]}
        >
          {maxWidth ? (
            <View style={[styles.column, { maxWidth }]}>{children}</View>
          ) : (
            children
          )}
        </FadePanel>
      ) : (
        <FadePanel
          // The panel covers the sides. Its long top fade leaves the background
          // visible and starts above the heading, which sits inside the fade.
          x={0}
          top={flush ? (phone ? 90 : 110) : phone ? 150 : 190}
          bottom={0}
          pad={flush ? (phone ? 12 : 28) : phone ? 22 : 84}
          style={[
            styles.panel,
            {
              // Starts under the top bar so the bar's image lines up seamlessly.
              // Narrow Windows windows still have caption buttons at the top.
              marginTop: phone ? (Platform.OS === 'windows' ? 32 : 0) : 88,
              // The player keeps the title close to the bar so the video and
              // episode rail fit in one screen.
              paddingTop: flush ? (phone ? 40 : 36) : 76,
              paddingBottom: phone ? 72 : 112,
            },
          ]}
        >
          {maxWidth ? (
            <View style={[styles.column, { maxWidth }]}>{children}</View>
          ) : (
            children
          )}
        </FadePanel>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  slice: { position: 'absolute' },
  barFade: { position: 'absolute', top: 0, left: 0, right: 0 },
  fill: { width: '100%', height: '100%' },
  column: { width: '100%', alignSelf: 'center' },
  body: { backgroundColor: colors.panel },
  page: { flexGrow: 1, alignItems: 'center' },
  hubPage: { alignItems: 'center', justifyContent: 'flex-end' },
  bottomPanel: { width: '100%' },
  // Short pages still reach the window bottom.
  panel: { width: '100%', flexGrow: 1 },
  overpan: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -2000,
    height: 2000,
    backgroundColor: colors.panel,
  },
});
