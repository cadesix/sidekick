import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// "Seen" stamps behind the dock's notification dots: each dot clears the moment
// its surface is LOOKED AT, and re-arms when there's new cause —
//  - Goals: a goal not yet done today (re-arms at local midnight with the day)
//  - Shop: the rotation restocks at local midnight; a day you haven't peeked = new stock
//  - Messages: the sidekick wrote after your last visit to the chat
// Persisted so a reload (or tomorrow's launch) remembers what you've seen.

export const localDay = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

type Store = {
  goalsSeenDate: string | null;
  shopSeenDate: string | null;
  // newest chat timestamp (ms) the user has seen; null = never opened the chat,
  // which deliberately shows NO badge (onboarding walks them into it anyway)
  msgsSeenAt: number | null;
  // AsyncStorage rehydrates async — dots wait for it so the pre-hydration nulls
  // can't flash a dot the stored stamps would suppress
  hydrated: boolean;
  markGoalsSeen: () => void;
  markShopSeen: () => void;
  markMsgsSeen: (at: number) => void;
};

export const useDockBadges = create<Store>()(
  persist(
    (set) => ({
      goalsSeenDate: null,
      shopSeenDate: null,
      msgsSeenAt: null,
      hydrated: false,
      markGoalsSeen: () => set({ goalsSeenDate: localDay() }),
      markShopSeen: () => set({ shopSeenDate: localDay() }),
      // never move the stamp backwards — a stale caller can't resurrect a badge
      markMsgsSeen: (at) => set((s) => ({ msgsSeenAt: Math.max(s.msgsSeenAt ?? 0, at) })),
    }),
    {
      name: 'sidekick_dock_badges',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ goalsSeenDate: s.goalsSeenDate, shopSeenDate: s.shopSeenDate, msgsSeenAt: s.msgsSeenAt }),
      onRehydrateStorage: () => () => {
        useDockBadges.setState({ hydrated: true });
      },
    },
  ),
);
