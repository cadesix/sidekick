import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// DEV-only presentation experiments, persisted so a reload keeps the variant
// under review. Read by Home, set from the DevPanel.
//
// chatUiMode — which Messages presentation is live:
//  'sheet'      the original bottom sheet; the character peeks above it on his phone
//  'fullscreen' full-screen takeover, iOS icon-morph launch animation
//  'sky'        camera pans up, character at the bottom, the chat floats above him

export type ChatUiMode = 'sheet' | 'fullscreen' | 'sky';
export const CHAT_UI_MODES: ChatUiMode[] = ['sheet', 'fullscreen', 'sky'];

type Store = {
  chatUiMode: ChatUiMode;
  setChatUiMode: (m: ChatUiMode) => void;
};

export const useDevPrefs = create<Store>()(
  persist(
    (set) => ({
      chatUiMode: 'fullscreen',
      setChatUiMode: (m) => set({ chatUiMode: m }),
    }),
    {
      name: 'sidekick_dev_prefs',
      // inert storage under expo-router's node renderer (no `window` there) —
      // same guard as dockBadges; a persist write would kill the dev server
      storage: createJSONStorage(() =>
        typeof window === 'undefined'
          ? { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }
          : AsyncStorage,
      ),
    },
  ),
);
