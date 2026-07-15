import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { type GoalOption, resolveGoals, todayIndex, weekKey } from '@sidekick/core';

// Weekly habit checks: per ISO week, per goal, a 7-slot Mon..Sun boolean row.
// Only today's slot is togglable. Math comes from @sidekick/core.

type WeekChecks = Record<string, boolean[]>; // goal value → bool[7]

type GoalsState = {
  chosen: string[]; // goal values picked in onboarding
  checks: Record<string, WeekChecks>; // isoWeek → checks
  hydrated: boolean;
  goals: () => GoalOption[]; // resolved options (chosen, or all)
  doneToday: (goalValue: string) => boolean;
  toggleToday: (goalValue: string) => void;
  setChosen: (values: string[]) => void;
};

export const useGoals = create<GoalsState>()(
  persist(
    (set, get) => ({
      chosen: [],
      checks: {},
      hydrated: false,
      goals: () => resolveGoals(get().chosen),
      doneToday: (goalValue) => {
        const week = weekKey(new Date());
        return get().checks[week]?.[goalValue]?.[todayIndex(new Date())] ?? false;
      },
      toggleToday: (goalValue) => {
        const week = weekKey(new Date());
        const idx = todayIndex(new Date());
        set((st) => {
          const wk = { ...(st.checks[week] ?? {}) };
          const row = [...(wk[goalValue] ?? new Array(7).fill(false))];
          row[idx] = !row[idx];
          wk[goalValue] = row;
          return { checks: { ...st.checks, [week]: wk } };
        });
      },
      setChosen: (values) => set({ chosen: values }),
    }),
    {
      name: 'sidekick_goals_v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (st) => ({ chosen: st.chosen, checks: st.checks }),
      onRehydrateStorage: () => (state) => state && (state.hydrated = true),
    },
  ),
);
