import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { BOND_MIN, clampBond } from '@sidekick/core';

// Bond score (10–100). Grows via guided sessions (they call addBond). Map
// destinations unlock at bond thresholds; the value floats over the head.

type BondState = {
  bond: number;
  addBond: (amount: number) => number;
  setBond: (value: number) => void;
};

export const useBond = create<BondState>()(
  persist(
    (set, get) => ({
      bond: BOND_MIN,
      addBond: (amount) => {
        const next = clampBond(get().bond + amount);
        set({ bond: next });
        return next;
      },
      setBond: (value) => set({ bond: clampBond(value) }),
    }),
    {
      name: 'sidekick_bond_v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (st) => ({ bond: st.bond }),
    },
  ),
);
