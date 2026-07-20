import { create } from 'zustand';

// After a game turn submits, the sidekick's reply card is already in the
// transcript (the server plays its turn inside the same mutation). Revealing it
// the instant the overlay closes reads as robotic, so GameOverlay calls hold()
// with the message ids visible before the refetch; useSidekickChat keeps any
// newer sidekick rows hidden behind the typing indicator until the timer fires.

type GameRevealState = {
  holding: boolean;
  knownIds: ReadonlySet<string>;
  hold: (knownIds: Iterable<string>, ms?: number) => void;
};

export const useGameReveal = create<GameRevealState>((set) => ({
  holding: false,
  knownIds: new Set(),
  hold: (knownIds, ms = 1800) => {
    set({ holding: true, knownIds: new Set(knownIds) });
    setTimeout(() => set({ holding: false, knownIds: new Set() }), ms);
  },
}));

export const holdGameReveal = (knownIds: Iterable<string>, ms?: number) =>
  useGameReveal.getState().hold(knownIds, ms);
