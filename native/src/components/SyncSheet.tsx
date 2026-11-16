import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button, Sheet, TextButton } from './controls';
import { colors, fontFamily, ui } from '../design/theme';
import { useViewport } from '../design/viewport';
import { SyncState } from '../app/useSync';
import { Change, Choice, resolveConflicts } from '../services/sync/merge';
import { changesFor } from '../services/sync/client';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Asks before a sync changes anything: what changes on each device, which
 * titles were changed differently on both, or, for a different library on the
 * PC, whether to take that one instead. After this device says yes, the PC is
 * asked too, and this sheet waits for its answer.
 */
export function SyncSheet({
  sync,
  onError,
}: {
  sync: SyncState;
  onError: (error: unknown) => void;
}): React.JSX.Element {
  const plan = sync.prepared;
  // Narrow screens put each title above its two choices.
  const { width, height } = useViewport();
  const narrow = width < 600;
  const conflicts = plan?.kind === 'merge' ? plan.merge.conflicts : [];
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  useEffect(() => setChoices({}), [plan]);
  const choose = (id: string, choice: Choice) =>
    setChoices(current => ({ ...current, [id]: choice }));
  const chooseAll = (choice: Choice) =>
    setChoices(Object.fromEntries(conflicts.map(c => [c.id, choice])));
  const settled = conflicts.every(c => choices[c.id]);
  // The lists follow the choices, so both devices see exactly what will happen.
  const changes = useMemo(
    () =>
      plan?.kind === 'merge'
        ? changesFor(
            plan.sides,
            resolveConflicts(plan.merge.catalog, plan.merge.conflicts, choices),
          )
        : { toLocal: [], toRemote: [] },
    [plan, choices],
  );
  const go = () => {
    sync.confirm(choices).catch(onError);
  };
  return (
    <Sheet
      title={
        plan?.kind === 'different'
          ? 'Different library on the PC'
          : 'Sync with PC'
      }
      visible={plan !== null && plan.kind !== 'inSync'}
      onClose={sync.waiting ? sync.stopWaiting : sync.cancel}
    >
      {plan?.kind === 'different' && (
        <>
          <Text style={ui.text}>
            The PC holds a different library from this device, so the two cannot
            be merged. You can replace this device's library with the PC's. A
            copy of this one is kept in Settings → Browse archived snapshots.
          </Text>
          <View style={styles.actions}>
            <Button label="Cancel" onPress={sync.cancel} />
            <Button
              label="Use the PC's library"
              danger
              disabled={sync.busy}
              onPress={go}
            />
          </View>
        </>
      )}
      {plan?.kind === 'merge' && sync.waiting && (
        <>
          <View style={styles.waiting}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[ui.text, ui.grow]}>
              Confirm the sync on the PC. Nothing changes on either device until
              it does.
            </Text>
          </View>
          <View style={styles.actions}>
            <Button label="Stop waiting" onPress={sync.stopWaiting} />
          </View>
        </>
      )}
      {plan?.kind === 'merge' && !sync.waiting && (
        <>
          <Text style={ui.text}>
            {summary(changes, 'this device', 'the PC')} The PC confirms too
            before anything is saved. Videos and folder locations stay where
            they are.
          </Text>
          <ChangeSides
            here="This device"
            there="PC"
            changes={changes}
            height={height}
          />
          {conflicts.length > 0 && (
            <>
              <Text style={[ui.subheading, styles.gap]}>
                {plural(conflicts.length, 'title')} changed on both devices
              </Text>
              <Text style={ui.muted}>
                Choose which version of each to keep.
              </Text>
              <View style={styles.wrapRow}>
                <TextButton
                  label="Keep this device's for all"
                  onPress={() => chooseAll('local')}
                />
                <TextButton
                  label="Keep the PC's for all"
                  onPress={() => chooseAll('remote')}
                />
              </View>
              <ScrollView
                nestedScrollEnabled
                style={[styles.rule, { maxHeight: listHeight(height) }]}
              >
                {conflicts.map(conflict => (
                  <View
                    key={conflict.id}
                    style={[styles.row, narrow && styles.rowNarrow]}
                  >
                    <Text
                      numberOfLines={2}
                      style={[styles.title, narrow && styles.titleNarrow]}
                    >
                      {conflict.title}
                      {conflict.remote.title !== conflict.local.title
                        ? ` / ${conflict.remote.title}`
                        : ''}
                    </Text>
                    <View style={styles.wrapRow}>
                      <TextButton
                        label="This device"
                        active={choices[conflict.id] === 'local'}
                        onPress={() => choose(conflict.id, 'local')}
                      />
                      <TextButton
                        label="PC"
                        active={choices[conflict.id] === 'remote'}
                        onPress={() => choose(conflict.id, 'remote')}
                      />
                    </View>
                  </View>
                ))}
              </ScrollView>
            </>
          )}
          <View style={styles.actions}>
            <Button label="Cancel" onPress={sync.cancel} />
            <Button
              label={sync.busy ? 'Syncing…' : 'Sync'}
              primary
              disabled={sync.busy || !settled}
              onPress={go}
            />
          </View>
        </>
      )}
    </Sheet>
  );
}

/**
 * The PC's half of the confirmation: the phone has said yes, and nothing is
 * saved here until the person at the PC does too.
 */
export function SyncApprovalSheet({
  sync,
}: {
  sync: SyncState;
}): React.JSX.Element {
  const proposal = sync.incoming;
  const { height } = useViewport();
  const changes = proposal?.changes ?? { toLocal: [], toRemote: [] };
  return (
    <Sheet
      title="Sync with phone"
      visible={proposal?.status === 'waiting'}
      onClose={() => sync.answer(false)}
    >
      <Text style={ui.text}>
        {summary(changes, 'this PC', 'the phone')} Your phone has confirmed;
        nothing is saved on either device until you apply it here.
      </Text>
      <ChangeSides
        here="This PC"
        there="Phone"
        changes={changes}
        height={height}
      />
      <View style={styles.actions}>
        <Button label="Decline" onPress={() => sync.answer(false)} />
        <Button label="Apply sync" primary onPress={() => sync.answer(true)} />
      </View>
    </Sheet>
  );
}

function summary(
  changes: { toLocal: Change[]; toRemote: Change[] },
  here: string,
  there: string,
): string {
  const { toLocal, toRemote } = changes;
  if (!toLocal.length && !toRemote.length) {
    return 'No titles change; only the choices below are needed.';
  }
  return `${plural(toLocal.length, 'title')} change on ${here}, ${plural(
    toRemote.length,
    'title',
  )} on ${there}.`;
}

/** The two devices as tabs, each with the titles that change on it. */
function ChangeSides({
  here,
  there,
  changes,
  height,
}: {
  here: string;
  there: string;
  changes: { toLocal: Change[]; toRemote: Change[] };
  height: number;
}): React.JSX.Element | null {
  const { toLocal, toRemote } = changes;
  const [side, setSide] = useState<'local' | 'remote'>('local');
  const empty = !toLocal.length && !toRemote.length;
  // Open on whichever side actually changes.
  const firstSide = toLocal.length || !toRemote.length ? 'local' : 'remote';
  useEffect(() => setSide(firstSide), [firstSide]);
  if (empty) {
    return null;
  }
  return (
    <>
      <View accessibilityRole="tablist" style={styles.wrapRow}>
        <TextButton
          label={`${here} (${toLocal.length})`}
          active={side === 'local'}
          onPress={() => setSide('local')}
        />
        <TextButton
          label={`${there} (${toRemote.length})`}
          active={side === 'remote'}
          onPress={() => setSide('remote')}
        />
      </View>
      <ChangeList
        changes={side === 'local' ? toLocal : toRemote}
        height={height}
      />
    </>
  );
}

/** Tall enough to read, short enough that the buttons stay on screen. */
const listHeight = (height: number) =>
  Math.round(Math.min(420, Math.max(160, (height || 700) * 0.4)));

const KIND: Record<Change['kind'], { label: string; color: string }> = {
  added: { label: 'New', color: colors.accent },
  removed: { label: 'Removed', color: colors.danger },
  changed: { label: '', color: colors.muted },
};

/** One row per title: what it is, and each thing about it that changes. */
function ChangeList({
  changes,
  height,
}: {
  changes: Change[];
  height: number;
}): React.JSX.Element {
  if (!changes.length) {
    return <Text style={ui.muted}>Nothing changes here.</Text>;
  }
  return (
    <ScrollView
      nestedScrollEnabled
      style={[styles.rule, { maxHeight: listHeight(height) }]}
    >
      {changes.map(change => {
        const kind = KIND[change.kind];
        return (
          <View
            key={change.key}
            accessible
            accessibilityLabel={[kind.label, change.title, ...change.details]
              .filter(Boolean)
              .join(', ')}
            style={[styles.change, { borderLeftColor: kind.color }]}
          >
            <View style={styles.changeHead}>
              <Text style={styles.changeTitle}>{change.title}</Text>
              {kind.label !== '' && (
                <Text style={[styles.tag, { color: kind.color }]}>
                  {kind.label}
                </Text>
              )}
            </View>
            {change.details.map((detail, i) => (
              <Text key={i} style={styles.detail}>
                {detail}
              </Text>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  rule: { borderTopWidth: 1, borderColor: colors.line },
  change: {
    borderLeftWidth: 3,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 4,
    gap: 3,
  },
  changeHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    columnGap: 10,
  },
  changeTitle: {
    flexShrink: 1,
    fontFamily,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
  },
  tag: { fontFamily, fontSize: 13 },
  detail: { fontFamily, fontSize: 13, lineHeight: 18, color: colors.muted },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  gap: { marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  rowNarrow: { flexDirection: 'column', alignItems: 'flex-start', gap: 4 },
  title: { flex: 1, fontFamily, fontSize: 15, color: colors.text },
  titleNarrow: { flex: 0 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 12,
  },
});
