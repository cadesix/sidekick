import { create } from 'zustand';

// A monotonically-increasing counter bumped whenever the worn outfit changes
// (equip / remove / recolor via the Shop or Closet). The live head avatars
// (which can't share a cached snapshot the way web does) subscribe to it and
// regenerate so they always reflect the current character. Outfit edits are
// discrete taps, so a regenerate-per-change is cheap enough.
type CosmeticVersion = {
  v: number;
  bump: () => void;
};

export const useCosmeticVersion = create<CosmeticVersion>((set) => ({
  v: 0,
  bump: () => set((st) => ({ v: st.v + 1 })),
}));
