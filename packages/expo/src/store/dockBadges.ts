import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { localDay } from '@sidekick/core';

import { ssrSafeStorage } from './persist-storage';

// "Seen" stamps behind the dock's notification dots: each dot clears the moment
// its surface is LOOKED AT, and re-arms when there's new cause —
//  - Goals: a goal not yet done today (re-arms at local midnight with the day)
//  - Shop: the rotation restocks at local midnight; a day you haven't peeked = new stock
//  - Messages: the sidekick wrote after your last visit to the chat
// Persisted so a reload (or tomorrow's launch) remembers what you've seen.
// "Day" is core's localDay — the SAME local-midnight day the streak and the
// shop restock roll on, so the badges can't drift from them.

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

// Wipe the stamps on an account transition — called beside auth-session's query
// cache + mirror wipe so one account's "seen" can't suppress another's badges.
export function resetDockBadges(): void {
  useDockBadges.setState({ goalsSeenDate: null, shopSeenDate: null, msgsSeenAt: null });
}

export const useDockBadges = create<Store>()(
  persist(
    (set) => ({
      goalsSeenDate: null,
      shopSeenDate: null,
      msgsSeenAt: null,
      hydrated: false,
      // no-op guards: an unchanged stamp would still notify subscribers AND
      // trigger a persist write (JSON + AsyncStorage) on every repeat visit
      markGoalsSeen: () =>
        set((s) => (s.goalsSeenDate === localDay(Date.now()) ? s : { goalsSeenDate: localDay(Date.now()) })),
      markShopSeen: () =>
        set((s) => (s.shopSeenDate === localDay(Date.now()) ? s : { shopSeenDate: localDay(Date.now()) })),
      // never move the stamp backwards — a stale caller can't resurrect a badge
      markMsgsSeen: (at) => set((s) => (at <= (s.msgsSeenAt ?? 0) ? s : { msgsSeenAt: at })),
    }),
    {
      name: 'sidekick_dock_badges',
      storage: ssrSafeStorage(),
      partialize: (s) => ({ goalsSeenDate: s.goalsSeenDate, shopSeenDate: s.shopSeenDate, msgsSeenAt: s.msgsSeenAt }),
      onRehydrateStorage: () => () => {
        useDockBadges.setState({ hydrated: true });
      },
    },
  ),
);
