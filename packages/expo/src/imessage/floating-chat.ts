import { createContext } from "react";

// True while the chat renders as the "sky" floating presentation (transparent
// over the 3D scene). Bubbles read this to swap their solid brand fills for
// frosted glass + white text; provided by ChatScreen so it doesn't have to be
// threaded through MessageRow/MessageContent/MessageBubble props.
export const FloatingChat = createContext(false);
