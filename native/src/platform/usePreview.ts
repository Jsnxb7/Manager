import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import { Workspace } from '../app/useWorkspace';
import { subscribeScroll } from '../components/Fade';
import { useSheetOpen } from '../components/controls';
import { useViewport } from '../design/viewport';
import { MediaResolver } from '../services/media';
import { playerCommand } from './nativePlayer';

/** What to preview: an episode of a catalog title, from a position in seconds. */
export type PreviewSource = {
  entryId: string;
  episodeId: string;
  start: number;
};

const WIDTH = 320;
const HEIGHT = 180;
const GAP = 12;
const TOP_BAR = 100;
const DELAY = 400;

// One preview at a time, app-wide; a newer hover or a leave cancels older opens.
let token = 0;
let showing = false;
function closePreview(): void {
  token++;
  if (showing) {
    showing = false;
    playerCommand('previewClose').catch(() => undefined);
  }
}

/** Where the 16:9 preview goes: beside the item, inside the window. */
export function previewRect(
  item: { x: number; y: number; width: number; height: number },
  window: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  let x = item.x + item.width + GAP;
  if (x + WIDTH > window.width - GAP) {
    x = item.x - WIDTH - GAP;
  }
  if (x < GAP) {
    x = Math.min(
      Math.max(GAP, item.x + (item.width - WIDTH) / 2),
      window.width - WIDTH - GAP,
    );
  }
  const y = Math.min(
    Math.max(TOP_BAR + GAP, item.y + item.height / 2 - HEIGHT / 2),
    window.height - HEIGHT - GAP,
  );
  return { x, y, width: WIDTH, height: HEIGHT };
}

/**
 * Hover previews on Windows: a muted clip of the episode plays beside the hovered
 * item, as the old app did. Elsewhere this does nothing.
 */
export function usePreview(
  w: Workspace,
  source: PreviewSource | null,
): {
  ref: React.RefObject<View | null>;
  onHoverIn: () => void;
  onHoverOut: () => void;
} {
  const ref = useRef<View | null>(null);
  const mine = useRef(-1);
  const sheet = useSheetOpen();
  const viewport = useViewport();
  const latest = useRef({ w, source, sheet, viewport });
  latest.current = { w, source, sheet, viewport };
  const leave = () => {
    if (mine.current === token) {
      closePreview();
    }
    mine.current = -1;
  };
  useEffect(() => {
    if (Platform.OS !== 'windows') {
      return;
    }
    const stop = subscribeScroll(() => leave());
    return () => {
      stop();
      leave();
    };
  }, []);
  const enter = () => {
    const { source: wanted } = latest.current;
    if (Platform.OS !== 'windows' || !wanted || latest.current.sheet) {
      return;
    }
    closePreview();
    const ticket = ++token;
    mine.current = ticket;
    setTimeout(async () => {
      const now = latest.current;
      const entry = now.w.catalog?.entries.find(e => e.id === wanted.entryId);
      if (ticket !== token || !entry || !now.w.io || now.sheet) {
        return;
      }
      try {
        const files = await new MediaResolver(now.w.io).check(
          entry,
          now.w.settings,
        );
        const file = files[wanted.episodeId];
        if (ticket !== token || !file || file.state !== 'available') {
          return;
        }
        ref.current?.measureInWindow((x, y, width, height) => {
          if (ticket !== token) {
            return;
          }
          const rect = previewRect(
            { x, y, width, height },
            {
              width: latest.current.viewport.width,
              height: latest.current.viewport.height,
            },
          );
          showing = true;
          playerCommand('previewOpen', {
            uri: file.uri,
            start: wanted.start,
            ...rect,
          }).catch(() => undefined);
        });
      } catch {
        // A preview is a nicety; a missing or unreadable file shows nothing.
      }
    }, DELAY);
  };
  return { ref, onHoverIn: enter, onHoverOut: leave };
}
