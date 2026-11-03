import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSheetOpen } from '../components/controls';
import { subscribeScroll } from '../components/Fade';
import { colors, fontFamily, ui } from '../design/theme';
import { useViewport } from '../design/viewport';
import { playerCommand } from './nativePlayer';

const TOP_BAR = 88;
const BOTTOM_BAR = 64;

/**
 * Marks where the video goes. The native video view floats over this rectangle,
 * so it follows layout and scrolling, and stays clipped below the navigation.
 */
export default function VideoSurface({
  title,
  detail,
}: {
  title: string;
  detail: string;
}): React.JSX.Element {
  const stage = useRef<View>(null);
  const [areaWidth, setAreaWidth] = useState(0);
  const hidden = useSheetOpen();
  const { width, height } = useViewport();
  const phone = width < 700;
  const place = useCallback(() => {
    stage.current?.measureInWindow((x, y, w, h) => {
      playerCommand('place', {
        x,
        y,
        width: w,
        height: h,
        hidden,
        clipTop: phone ? 32 : TOP_BAR,
        clipBottom: phone ? BOTTOM_BAR : 0,
      }).catch(() => undefined);
    });
  }, [hidden, phone]);
  useEffect(() => {
    place();
    return subscribeScroll(place);
  }, [place]);
  return (
    <View
      ref={stage}
      onLayout={e => {
        setAreaWidth(e.nativeEvent.layout.width);
        place();
      }}
      // The video and the episode rail should both fit below the heading.
      style={[
        styles.stage,
        {
          height: Math.min(
            (areaWidth || width) * (9 / 16),
            // Full 16:9 height when the window allows, below the heading; the
            // episode rail follows underneath and scrolls into view.
            Math.max(220, height - (phone ? 150 : 190)),
          ),
        },
      ]}
    >
      <Text style={styles.title}>{title}</Text>
      {detail !== '' && <Text style={ui.muted}>{detail}</Text>}
    </View>
  );
}
const styles = StyleSheet.create({
  stage: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#000000',
  },
  title: { fontFamily, fontSize: 18, fontWeight: '600', color: colors.text },
});
