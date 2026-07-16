import { Platform, type ViewStyle } from 'react-native';

// `touchAction` / `userSelect` are react-native-web style props (they're in RNW's
// style types and it uses `touchAction` internally for ScrollView); RN native has
// no equivalent, so these are gated to web and cast past RN's ViewStyle.
//
// Apply to any view that claims a drag via the responder system — the 3D canvas,
// slider tracks. `touch-action: none` tells the browser not to claim the touch for
// panning/pinch-zoom BEFORE JS ever sees it: the browser decides on touchstart, so
// preventDefault from the responder is already too late and the page pans under the
// gesture. `user-select: none` stops a drag from turning into a text selection.
//
// Scoped deliberately: setting this on <body> would also kill touch scrolling in
// every ScrollView (touch-action is resolved across the whole ancestor chain), so
// it goes on the drag surfaces themselves, never globally.
export const NO_BROWSER_PAN: ViewStyle =
  Platform.OS === 'web' ? ({ touchAction: 'none', userSelect: 'none' } as ViewStyle) : {};
