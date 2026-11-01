import React, { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { colors } from '../design/theme';
import { IconButton } from './Icon';

/** Pointer/touch reordering previews locally and commits once on release. */
export function DragList({
  ids,
  onReorder,
  renderItem,
  disabled = false,
}: {
  ids: readonly string[];
  onReorder: (ids: string[]) => void;
  renderItem: (id: string, index: number) => React.ReactNode;
  disabled?: boolean;
}): React.JSX.Element {
  const [preview, setPreview] = useState<string[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const layouts = useRef(new Map<string, { y: number; height: number }>());
  const drag = useRef<{
    id: string;
    ids: string[];
    centers: number[];
    center: number;
    next: string[];
  } | null>(null);
  const latest = useRef({ ids, onReorder });
  latest.current = { ids, onReorder };
  const finish = (commit: boolean) => {
    const value = drag.current;
    drag.current = null;
    setActive(null);
    setPreview(null);
    if (
      commit &&
      value &&
      value.ids.some((id, i) => id !== value.next[i]) &&
      value.ids.length === latest.current.ids.length &&
      value.ids.every((id, i) => id === latest.current.ids[i])
    ) {
      latest.current.onReorder(value.next);
    }
  };
  return (
    <View>
      {(preview ?? ids).map((id, index) => {
        const responder = PanResponder.create({
          onStartShouldSetPanResponderCapture: () =>
            !disabled && ids.length > 1,
          onMoveShouldSetPanResponderCapture: () => !disabled && ids.length > 1,
          onPanResponderGrant: () => {
            const original = [...ids];
            const centers = original.map(key => {
              const layout = layouts.current.get(key);
              return layout ? layout.y + layout.height / 2 : 0;
            });
            drag.current = {
              id,
              ids: original,
              centers,
              center: centers[index] ?? 0,
              next: original,
            };
            setActive(id);
          },
          onPanResponderMove: (_, gesture) => {
            const value = drag.current;
            if (!value) {
              return;
            }
            const center = value.center + gesture.dy;
            const others = value.ids.filter(key => key !== value.id);
            const at = others.filter(
              key => center > value.centers[value.ids.indexOf(key)]!,
            ).length;
            const next = [...others];
            next.splice(at, 0, value.id);
            value.next = next;
            setPreview(next);
          },
          onPanResponderRelease: () => finish(true),
          onPanResponderTerminate: () => finish(false),
          onPanResponderTerminationRequest: () => false,
          onShouldBlockNativeResponder: () => true,
        });
        return (
          <View
            key={id}
            onLayout={event => {
              layouts.current.set(id, event.nativeEvent.layout);
            }}
            style={[styles.row, active === id && styles.moving]}
          >
            {!disabled && (
              <View {...responder.panHandlers} style={styles.handle}>
                <IconButton
                  icon="list"
                  label="Drag to reorder"
                  size={14}
                  disabled={ids.length < 2}
                  onPress={() => undefined}
                />
              </View>
            )}
            <View style={styles.content}>{renderItem(id, index)}</View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  handle: { alignSelf: 'stretch', justifyContent: 'center' },
  content: { flex: 1, minWidth: 0 },
  moving: { backgroundColor: colors.hover },
});
