import { create } from 'zustand';

// Fire-and-forget speech line over the character's head. Web dispatches a window
// CustomEvent; RN has none, so a tiny store carries the latest line + a nonce
// (bumped every speak so a replacement re-triggers the spring even with identical
// text). The SpeechBubble component owns the show/hide timers.

type SpeechState = {
  text: string;
  ms: number;
  nonce: number;
  speak: (text: string, ms?: number) => void;
};

export const useSpeech = create<SpeechState>((set) => ({
  text: '',
  ms: 4500,
  nonce: 0,
  speak: (text, ms = 4500) => set((s) => ({ text, ms, nonce: s.nonce + 1 })),
}));

// module-level helper mirroring web's speak(text, ms)
export const speak = (text: string, ms?: number) => useSpeech.getState().speak(text, ms);
