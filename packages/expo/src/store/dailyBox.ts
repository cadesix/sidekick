import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { type BoxReward, localDay, rollDailyBox } from '@sidekick/core';

import { useEconomy } from './economy';

// One box per local day. The roll is seeded by the day, so preview() (shown all
// day) equals the claimed result. claim() grants coins + any milestone item via
// the economy store and is idempotent per day.

type DailyBoxState = {
  lastClaimed: string; // local YYYY-MM-DD
  hydrated: boolean;
  hasBox: () => boolean;
  preview: (streak: number) => BoxReward;
  claim: (streak: number) => BoxReward | null;
};

export const useDailyBox = create<DailyBoxState>()(
  persist(
    (set, get) => ({
      lastClaimed: '',
      hydrated: false,
      hasBox: () => get().lastClaimed !== localDay(Date.now()),
      preview: (streak) => rollDailyBox(streak, localDay(Date.now())),
      claim: (streak) => {
        if (!get().hasBox()) return null;
        const reward = rollDailyBox(streak, localDay(Date.now()));
        set({ lastClaimed: localDay(Date.now()) });
        const econ = useEconomy.getState();
        econ.addCoins(reward.total);
        if (reward.milestone?.render) econ.addToInventory(reward.milestone.render);
        return reward;
      },
    }),
    {
      name: 'sidekick_daily_box_v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (st) => ({ lastClaimed: st.lastClaimed }),
      onRehydrateStorage: () => (state) => state && (state.hydrated = true),
    },
  ),
);
