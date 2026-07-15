import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { clampCoins, START_COINS, START_INVENTORY } from '@sidekick/core';

// Coin balance + owned-cosmetics inventory. Logic/tables come from @sidekick/core
// (START_COINS, clamp); this store owns persistence via AsyncStorage. Web uses
// two bare localStorage keys + window events; native uses one persisted store +
// zustand subscriptions (equivalent behavior, per-device storage).

type EconomyState = {
  coins: number;
  inventory: string[]; // owned render keys (seeded with START_INVENTORY)
  addCoins: (amount: number) => number;
  // returns false and charges nothing when the balance can't cover it
  spendCoins: (amount: number) => boolean;
  addToInventory: (renderKey: string) => void;
  owns: (renderKey: string) => boolean;
};

export const useEconomy = create<EconomyState>()(
  persist(
    (set, get) => ({
      coins: START_COINS,
      inventory: [...START_INVENTORY],
      addCoins: (amount) => {
        const next = clampCoins(get().coins + amount);
        set({ coins: next });
        return next;
      },
      spendCoins: (amount) => {
        const bal = get().coins;
        if (bal < amount) return false;
        set({ coins: clampCoins(bal - amount) });
        return true;
      },
      addToInventory: (renderKey) => {
        if (get().inventory.includes(renderKey)) return;
        set((st) => ({ inventory: [...st.inventory, renderKey] }));
      },
      owns: (renderKey) => get().inventory.includes(renderKey),
    }),
    {
      name: 'sidekick_economy_v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (st) => ({ coins: st.coins, inventory: st.inventory }),
      // re-seed the starter set if an older payload predates it
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<EconomyState>;
        const inv = new Set([...START_INVENTORY, ...(p.inventory ?? [])]);
        return { ...current, coins: p.coins ?? START_COINS, inventory: [...inv] };
      },
    },
  ),
);
