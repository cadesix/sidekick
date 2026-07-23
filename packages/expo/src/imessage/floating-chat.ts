import { createContext } from "react";

// True while the chat renders as the "sky" floating presentation (transparent
// over the 3D scene). Meta text (timestamp separators, Read/Delivered, the
// swipe-revealed clock times) reads this to swap its gray for white — gray
// disappears against the environment; white would disappear against the
// sheet/fullscreen modes' white fill. Provided by ChatScreen.
export const FloatingChat = createContext(false);
