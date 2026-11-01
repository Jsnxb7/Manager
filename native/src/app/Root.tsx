import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  ImageBackground,
  Linking,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Route } from './routes';
import { useWorkspace } from './useWorkspace';
import { Button, Sheet, SheetHost, Toast } from '../components/controls';
import { BarFade } from '../components/Fade';
import { NavBar, SearchBar } from '../components/NavBar';
import { colors, fontFamily, ui } from '../design/theme';
import { ViewportContext, ViewportHeightContext } from '../design/viewport';
import { Hub } from '../screens/Hub';
import { Library } from '../screens/Library';
import { EntryForm } from '../screens/EntryForm';
import { Details } from '../screens/Details';
import { Player } from '../screens/Player';
import { Queue, QueueContent } from '../screens/Queue';
import { Settings } from '../screens/Settings';
import { CustomPlayer } from '../screens/CustomPlayer';

const mountains = require('../assets/backgrounds/mountains.webp');
const BAR_HEIGHT = Platform.OS === 'windows' ? 88 : 58;

export default function Root(): React.JSX.Element {
  const w = useWorkspace();
  const initialOpened = useRef(false);
  const [history, setHistory] = useState<Route[]>([{ name: 'home' }]);
  const [drawer, setDrawer] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });
  const { width } = useWindowDimensions();
  const phone = (windowSize.width || width) < 700;
  const route = history[history.length - 1]!;
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterCount, setFilterCount] = useState(0);
  const [searchBar, setSearchBar] = useState<SearchBar | null>(null);
  const closeFilters = useCallback(() => setFiltersOpen(false), []);
  const navigate = (next: Route) =>
    setHistory(stack =>
      stack[stack.length - 1]?.name === 'player' && next.name === 'player'
        ? [...stack.slice(0, -1), next]
        : [...stack, next],
    );
  const back = () =>
    setHistory(stack => (stack.length > 1 ? stack.slice(0, -1) : stack));
  // React Native Windows keeps stale text measurements after a resize, which
  // clips text, so pages without playback or typed input re-render once it settles.
  const [layoutKey, setLayoutKey] = useState(0);
  const settledWidth = useRef(0);
  useEffect(() => {
    if (Platform.OS !== 'windows' || !windowSize.width) {
      return;
    }
    const timer = setTimeout(() => {
      if (settledWidth.current && settledWidth.current !== windowSize.width) {
        setLayoutKey(key => key + 1);
      }
      settledWidth.current = windowSize.width;
    }, 250);
    return () => clearTimeout(timer);
  }, [windowSize.width]);
  const nav = (
    <NavBar
      key={layoutKey}
      route={route}
      sections={w.catalog?.sections ?? []}
      canGoBack={history.length > 1}
      queueCount={w.catalog?.queue.length ?? 0}
      phone={phone}
      searchOpen={searchOpen}
      filtersOpen={filtersOpen}
      filterCount={filterCount}
      searchBar={searchBar}
      onBack={back}
      navigate={navigate}
      onQueue={() => setDrawer(true)}
      onSearch={() => setSearchOpen(v => !v)}
      onFilters={() => setFiltersOpen(v => !v)}
    />
  );
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (drawer) {
          setDrawer(false);
          return true;
        }
        if (history.length > 1) {
          setHistory(stack => stack.slice(0, -1));
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [drawer, history.length]);
  useEffect(() => {
    if (!w.catalog || initialOpened.current) {
      return;
    }
    initialOpened.current = true;
    if (w.io?.initialMedia) {
      setHistory([
        { name: 'home' },
        { name: 'custom', initialUri: w.io.initialMedia },
      ]);
    }
    Linking.getInitialURL()
      .then(uri => {
        if (uri && /^(content|file):/i.test(uri)) {
          setHistory([{ name: 'home' }, { name: 'custom', initialUri: uri }]);
        }
      })
      .catch(w.setError);
  }, [w.catalog, w.io, w.setError]);
  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (/^(content|file):/i.test(url)) {
        setHistory([{ name: 'home' }, { name: 'custom', initialUri: url }]);
      }
    });
    return () => sub.remove();
  }, []);
  return (
    <ImageBackground
      source={mountains}
      resizeMode="cover"
      style={ui.screen}
      onLayout={e => setWindowSize(e.nativeEvent.layout)}
      accessibilityIgnoresInvertColors
    >
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <View pointerEvents="none" style={styles.dim} />
      {/* First in the tree so initial focus lands here, not on a page control that would scroll into view. */}
      {!phone && (
        <View pointerEvents="box-none" style={styles.floating}>
          {/* The same image at the same position, so the bar reads as part of
              the background while pages scroll beneath it. */}
          <View pointerEvents="none" style={styles.barImage}>
            <Image
              source={mountains}
              resizeMode="cover"
              style={{ width: windowSize.width, height: windowSize.height }}
            />
            <View style={styles.dim} />
          </View>
          <BarFade height={BAR_HEIGHT} />
          {nav}
        </View>
      )}
      <ViewportHeightContext.Provider value={windowSize.height}>
        <ViewportContext.Provider value={windowSize.width}>
          <View
            key={
              ['home', 'library', 'details', 'queue'].includes(route.name)
                ? layoutKey
                : 'stable'
            }
            style={styles.workspace}
          >
            <View style={ui.grow}>
              {!w.catalog ? (
                <View style={ui.page}>
                  <Text style={ui.heading}>Opening your local library</Text>
                  <Text style={ui.muted}>No server or account required.</Text>
                  {!w.busy && w.repo && (
                    <Button
                      label="Restore previous verified snapshot"
                      danger
                      onPress={() => {
                        w.run(async () => {
                          w.setCatalog(await w.repo!.restorePrevious());
                        }, 'Previous snapshot restored').catch(w.setError);
                      }}
                    />
                  )}
                  {!w.busy && (
                    <Button
                      label="Retry opening library"
                      onPress={() => {
                        w.retry().catch(w.setError);
                      }}
                    />
                  )}
                </View>
              ) : route.name === 'settings' ? (
                <Settings workspace={w} navigate={navigate} />
              ) : route.name === 'custom' ? (
                <CustomPlayer
                  key={route.initialUri ?? 'session'}
                  workspace={w}
                  initialUri={route.initialUri ?? ''}
                />
              ) : route.name === 'queue' ? (
                <Queue workspace={w} navigate={navigate} />
              ) : route.name === 'player' ? (
                <Player
                  key={route.animeId + route.episodeId}
                  workspace={w}
                  animeId={route.animeId}
                  episodeId={route.episodeId}
                  resume={route.resume}
                  queueAnchor={route.queueAnchor ?? null}
                  navigate={navigate}
                />
              ) : route.name === 'details' ? (
                <Details
                  key={route.animeId}
                  workspace={w}
                  animeId={route.animeId}
                  navigate={navigate}
                />
              ) : route.name === 'library' ? (
                <Library
                  key={route.sectionId}
                  workspace={w}
                  sectionId={route.sectionId}
                  navigate={navigate}
                  filtersOpen={filtersOpen}
                  onSearchBar={setSearchBar}
                  onCloseFilters={closeFilters}
                  onFilterCount={setFilterCount}
                />
              ) : route.name === 'add' ? (
                <EntryForm
                  key={route.sectionId}
                  workspace={w}
                  sectionId={route.sectionId}
                  navigate={navigate}
                />
              ) : route.name === 'home' ? (
                <Hub workspace={w} navigate={navigate} />
              ) : null}
            </View>
          </View>
        </ViewportContext.Provider>
      </ViewportHeightContext.Provider>
      {phone && nav}
      <View pointerEvents="none" style={styles.messages}>
        {w.busy && (
          <ActivityIndicator
            color={colors.chrome}
            accessibilityLabel="Working"
          />
        )}
      </View>
      <Sheet
        title="Queue"
        drawer
        visible={drawer}
        onClose={() => setDrawer(false)}
      >
        {w.catalog && (
          <QueueContent
            workspace={w}
            compact
            navigate={next => {
              setDrawer(false);
              navigate(next);
            }}
          />
        )}
        <Button
          label="Open full queue"
          onPress={() => {
            setDrawer(false);
            navigate({ name: 'queue' });
          }}
        />
      </Sheet>
      <SheetHost />
      {w.error !== '' ? (
        <Toast
          kind="error"
          message={w.error}
          bottom={phone ? 84 : 28}
          onDismiss={() => w.setError('')}
        />
      ) : (
        w.notice !== '' && (
          <Toast kind="success" message={w.notice} bottom={phone ? 84 : 28} />
        )
      )}
    </ImageBackground>
  );
}
const styles = StyleSheet.create({
  dim: { ...StyleSheet.absoluteFill, backgroundColor: '#060C14A6' },
  barImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: BAR_HEIGHT,
    overflow: 'hidden',
  },
  workspace: { flex: 1, flexDirection: 'row' },
  floating: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    // The window's caption buttons sit over this strip on Windows.
    paddingTop: Platform.OS === 'windows' ? 30 : 0,
  },
  messages: {
    position: 'absolute',
    top: BAR_HEIGHT + 6,
    left: 16,
    right: 16,
    zIndex: 3,
    alignItems: 'center',
    gap: 6,
  },
  feedback: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 6,
    backgroundColor: colors.panel,
    borderTopWidth: 1,
    borderColor: colors.line,
    gap: 12,
  },
  notice: {
    fontFamily,
    paddingHorizontal: 24,
    paddingVertical: 8,
    color: colors.success,
    fontSize: 14,
    backgroundColor: colors.panel,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
});
