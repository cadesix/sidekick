import { createContext } from "react";

// True while the chat renders as the "sky" floating presentation (transparent
// over the 3D scene). Meta text (timestamp separators, Read/Delivered, the
// swipe-revealed clock times) reads this to swap its gray for white — gray
// disappears against the environment; white would disappear against the
// sheet/fullscreen modes' white fill. Provided by ChatScreen.
export const FloatingChat = createContext(false);

// the one color meta text renders in over the scene — consumers share this so
// a third meta surface can't mint a fourth white
export const FLOATING_META_COLOR = "#FFFFFF";
