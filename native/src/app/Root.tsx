import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Route } from './routes';
import { useWorkspace } from './useWorkspace';
import { Button, Sheet } from '../components/controls';
import { colors, ui } from '../design/theme';
import { Hub } from '../screens/Hub';
import { Library } from '../screens/Library';
import { EntryForm } from '../screens/EntryForm';
import { Details } from '../screens/Details';
import { Player } from '../screens/Player';
import { Queue, QueueContent } from '../screens/Queue';
import { Settings } from '../screens/Settings';
import { CustomPlayer } from '../screens/CustomPlayer';

export default function Root(): React.JSX.Element {
  const w = useWorkspace();
  const initialOpened = useRef(false);
  const [history, setHistory] = useState<Route[]>([{ name: 'home' }]);
  const [drawer, setDrawer] = useState(false);
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const route = history[history.length - 1]!;
  const navigate = (next: Route) =>
    setHistory(stack =>
      stack[stack.length - 1]?.name === 'player' && next.name === 'player'
        ? [...stack.slice(0, -1), next]
        : [...stack, next],
    );
  const back = () =>
    setHistory(stack => (stack.length > 1 ? stack.slice(0, -1) : stack));
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
    <View style={ui.screen}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <View style={styles.titlebar}>
        <Text style={[ui.subheading, ui.grow]}>Anime Manager</Text>
        {history.length > 1 && <Button label="Back" onPress={back} />}
        <Button
          label={`Queue (${w.catalog?.queue.length ?? 0})`}
          onPress={() => setDrawer(true)}
        />
      </View>
      <View style={styles.workspace}>
        {wide && (
          <View style={styles.rail}>
            <Button label="Home" onPress={() => navigate({ name: 'home' })} />
            {w.catalog?.sections.map(section => (
              <Button
                key={section.id}
                label={section.title}
                onPress={() =>
                  navigate({ name: 'library', sectionId: section.id })
                }
              />
            ))}
            <View style={ui.grow} />
            <Button
              label="Custom Player"
              onPress={() => navigate({ name: 'custom' })}
            />
            <Button
              label="Settings"
              onPress={() => navigate({ name: 'settings' })}
            />
          </View>
        )}
        <View style={ui.grow}>
          {w.error !== '' && (
            <View accessibilityRole="alert" style={styles.feedback}>
              <Text selectable style={ui.error}>
                {w.error}
              </Text>
              <Button label="Dismiss" onPress={() => w.setError('')} />
            </View>
          )}
          {w.notice !== '' && (
            <Text accessibilityLiveRegion="polite" style={styles.notice}>
              {w.notice}
            </Text>
          )}
          {w.busy && (
            <ActivityIndicator
              color={colors.chrome}
              accessibilityLabel="Working"
            />
          )}
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
      {!wide && (
        <View style={styles.bottom}>
          <Button label="Home" onPress={() => navigate({ name: 'home' })} />
          <Button
            label="Anime"
            onPress={() => navigate({ name: 'library', sectionId: 'anime' })}
          />
          <Button label="Queue" onPress={() => navigate({ name: 'queue' })} />
          <Button label="More" onPress={() => navigate({ name: 'settings' })} />
        </View>
      )}
      <Sheet title="Queue" visible={drawer} onClose={() => setDrawer(false)}>
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
    </View>
  );
}
const styles = StyleSheet.create({
  titlebar: {
    minHeight: 66,
    paddingHorizontal: 20,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderColor: colors.raised,
  },
  workspace: { flex: 1, flexDirection: 'row' },
  rail: {
    width: 200,
    padding: 16,
    gap: 8,
    borderRightWidth: 1,
    borderColor: colors.raised,
  },
  bottom: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 8,
    gap: 4,
    borderTopWidth: 1,
    borderColor: colors.raised,
  },
  feedback: { padding: 12, backgroundColor: colors.panel, gap: 8 },
  notice: { padding: 12, color: colors.success, fontSize: 14 },
});
