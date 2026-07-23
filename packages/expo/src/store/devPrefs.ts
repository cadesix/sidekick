import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { ssrSafeStorage } from './persist-storage';

// DEV-only presentation experiments, persisted so a reload keeps the variant
// under review. Read by Home, set from the DevPanel.
//
// chatUiMode — which Messages presentation is live:
//  'sheet'      the original bottom sheet; the character peeks above it on his phone
//  'fullscreen' full-screen takeover, iOS icon-morph launch animation
//  'sky'        camera pans up, character at the bottom, the chat floats above him

export type ChatUiMode = 'sheet' | 'fullscreen' | 'sky';
export const CHAT_UI_MODES: ChatUiMode[] = ['sheet', 'fullscreen', 'sky'];

// the one mode production ships (also the store default) — change HERE when a
// winner is picked, nowhere else
const SHIPPED_CHAT_UI: ChatUiMode = 'fullscreen';

type Store = {
  chatUiMode: ChatUiMode;
  setChatUiMode: (m: ChatUiMode) => void;
};

export const useDevPrefs = create<Store>()(
  persist(
    (set) => ({
      chatUiMode: SHIPPED_CHAT_UI,
      setChatUiMode: (m) => set({ chatUiMode: m }),
    }),
    {
      name: 'sidekick_dev_prefs',
      storage: ssrSafeStorage(),
    },
  ),
);

// The ONLY sanctioned way to read the chat presentation: DEV builds follow the
// DevPanel switch; production pins the shipped mode without even subscribing —
// a persisted dev value can never steer (or re-render) a prod build.
export function useChatUiMode(): ChatUiMode {
  return useDevPrefs((s) => (process.env.NODE_ENV !== 'production' ? s.chatUiMode : SHIPPED_CHAT_UI));
}
