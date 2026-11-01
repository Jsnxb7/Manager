import { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';

/** Width measured from the root view; 0 until the first layout. */
export const ViewportContext = createContext(0);
export const ViewportHeightContext = createContext(0);

// React Native Windows does not update window metrics on resize and reports them
// off by the display scale, so pages use the root view's measured width instead.
export function useViewport(): { width: number; height: number } {
  const measured = useContext(ViewportContext);
  const measuredHeight = useContext(ViewportHeightContext);
  const { width, height } = useWindowDimensions();
  return { width: measured || width, height: measuredHeight || height };
}
