import { create } from 'zustand';

// What's left of the old persisted "context" blob after plan 20 phase 3:
// session progress/done live in the server snapshot (`snapshot.sessions`), the
// extracted profile (fields/notes) and astral card live behind the sessions
// router — this store keeps only genuinely ephemeral, non-persisted UI state.

// The astral card: the user's running "personality reading". NOT per-session —
// every completed star chat rewrites it from the whole accumulated profile.
// Null until the first session completes. Server-owned (`snapshot.astral`);
// exported here for the consumers that render it.
export type Astral = { archetype: string; reading: string; traits: string[] };

export type SidekickContext = {
  // An island unlocked but not yet seen on the map. Drives the dot on the dock's
  // map icon and the "new" bubble beside the island itself; cleared when the map
  // closes, i.e. once they've actually had a chance to look at it.
  unseenIsland: string | null;
  // a session completion just opened this island — flag it until the map is seen
  markUnseenIsland: (id: string) => void;
  // the map has been looked at — drop the unlock notification
  clearUnseenIsland: () => void;

  // This run's cumulative answers per session, so diving out of a session and
  // back in re-sends the full transcript with each `sessions.progress` upsert
  // (the server merges per index — a resent empty prefix can't wipe a stored
  // answer). The server holds the authoritative copy; this is never persisted.
  sessionAnswers: Record<string, string[]>;
  setSessionAnswers: (id: string, answers: string[]) => void;
};

export const useSidekickContext = create<SidekickContext>()((set) => ({
  unseenIsland: null,
  markUnseenIsland: (id) => set({ unseenIsland: id }),
  clearUnseenIsland: () => set({ unseenIsland: null }),

  sessionAnswers: {},
  setSessionAnswers: (id, answers) =>
    set((st) => ({ sessionAnswers: { ...st.sessionAnswers, [id]: answers } })),
}));
