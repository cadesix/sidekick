import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { computeStreak, localDay, type StreakState } from '@sidekick/core';

// Daily streak, bumped once per local day on app open (idempotent). A missed day
// resets to 1. Call touch() once after hydration.

type StreakStore = StreakState & {
  hydrated: boolean;
  touch: () => number;
};

export const useStreak = create<StreakStore>()(
  persist(
    (set, get) => ({
      count: 0,
      last: '',
      hydrated: false,
      touch: () => {
        const now = Date.now();
        const prev = get().last ? { count: get().count, last: get().last } : null;
        const next = computeStreak(prev, localDay(now), localDay(now, -1));
        set({ count: next.count, last: next.last });
        return next.count;
      },
    }),
    {
      name: 'sidekick_streak_v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (st) => ({ count: st.count, last: st.last }),
      onRehydrateStorage: () => (state) => state && (state.hydrated = true),
    },
  ),
);
