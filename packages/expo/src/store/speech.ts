import { create } from 'zustand';

// Fire-and-forget speech line over the character's head. Web dispatches a window
// CustomEvent; RN has none, so a tiny store carries the latest line + a nonce
// (bumped every speak so a replacement re-triggers the spring even with identical
// text). The SpeechBubble component owns the show/hide timers.

type SpeechState = {
  text: string;
  ms: number;
  nonce: number;
  // the face the sidekick wears while this line is up (null = leave his face be)
  expression: string | null;
  speak: (text: string, ms?: number, expression?: string | null) => void;
};

export const useSpeech = create<SpeechState>((set) => ({
  text: '',
  ms: 4500,
  nonce: 0,
  expression: null,
  speak: (text, ms = 4500, expression = null) =>
    set((s) => ({ text, ms, expression, nonce: s.nonce + 1 })),
}));

// module-level helper mirroring web's speak(text, ms, expression)
export const speak = (text: string, ms?: number, expression?: string | null) =>
  useSpeech.getState().speak(text, ms, expression);
