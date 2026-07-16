import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

// Web-only root HTML for static rendering; runs in Node, so no DOM/browser APIs
// and no global CSS imports here (that stays in the root layout).
//
// The app is a fixed, full-viewport surface — a drag on the scene orbits the
// camera and must never move the page itself. Expo's <ScrollViewStyleReset/>
// only sets `body{overflow:hidden}`, which stops document *scroll* but not the
// gestures that actually drag the UI out of frame: overscroll rubber-band /
// pull-to-refresh, and pinch/double-tap zoom. `lockViewport` covers those; the
// per-touch half lives on the drag surfaces themselves (see NO_BROWSER_PAN).
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* zoom pinned so a stray pinch/double-tap on the scene can't scale the
            page; viewport-fit=cover so safe-area insets resolve under notches */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
        <ScrollViewStyleReset />
        {/* after the reset so these win on the properties they share */}
        <style dangerouslySetInnerHTML={{ __html: lockViewport }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

// `position: fixed` on the body is what iOS Safari actually respects — it treats
// `overflow: hidden` as advisory and will still rubber-band the document.
const lockViewport = `
html, body {
  overscroll-behavior: none;
}
body {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}
`;
