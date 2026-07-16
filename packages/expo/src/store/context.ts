import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  islandOpensWith,
  isSessionDone as coreIsSessionDone,
  isSessionStartable as coreIsSessionStartable,
  nextSession as coreNextSession,
  sessionInProgress as coreSessionInProgress,
  type SessionDef,
  type SessionsState,
  type SessionState,
} from '@sidekick/core';

import { useBond } from './bond';
import { useEconomy } from './economy';

// The "context" the whole product reads about the user, mirroring the web app's
// `sidekick_context_v1` localStorage blob: extracted profile fields, verbatim
// notes, and per-session progress. Guided sessions write here (progress after
// every answer, then a completion that merges the LLM extraction and PAYS out
// bond + coins via the existing stores). Ladder gating reuses the pure helpers
// in @sidekick/core so web and native can never drift.

export type ContextNote = { tag: string; text: string; session?: string; ts?: number };

// what the extraction pass hands back on completion
export type Extracted = { fields: Record<string, string>; notes: { tag: string; text: string }[] };

// The astral card: the user's running "personality reading". NOT per-session —
// every completed star chat rewrites it from the whole accumulated profile, so
// it gets richer as the ladder goes on. Null until the first session completes.
export type Astral = { archetype: string; reading: string; traits: string[] };

export type SidekickContext = {
  fields: Record<string, string>;
  notes: ContextNote[];
  sessions: SessionsState;
  astral: Astral | null;
  // An island unlocked but not yet seen on the map. Drives the dot on the dock's
  // map icon and the "new" bubble beside the island itself; cleared when the map
  // closes, i.e. once they've actually had a chance to look at it.
  unseenIsland: string | null;

  // the map has been looked at — drop the unlock notification
  clearUnseenIsland: () => void;

  // persist progress after every answer so the user can dive out and back in
  saveSessionProgress: (id: string, beat: number, answers: string[]) => void;
  // merge extracted fields + notes, mark done, refresh the astral card, and pay
  // bond + coins
  completeSession: (def: SessionDef, extracted: Extracted, astral?: Astral | null) => void;

  // selectors mirroring the core ladder helpers over this store's `sessions`
  isSessionDone: (id: string) => boolean;
  isSessionStartable: (id: string) => boolean;
  nextSession: () => SessionDef | undefined;
  sessionInProgress: () => { def: SessionDef; state: SessionState } | null;

  // DEV-only (used by DevPanel): wipe all session progress to re-lock the map.
  resetSessions: () => void;
  // DEV-only: full guided-chat wipe — progress AND the extracted profile
  // (fields + notes), so a replayed alignment starts from a clean slate.
  resetGuidedChats: () => void;
};

export const useSidekickContext = create<SidekickContext>()(
  persist(
    (set, get) => ({
      fields: {},
      notes: [],
      sessions: {},
      astral: null,
      unseenIsland: null,

      clearUnseenIsland: () => set({ unseenIsland: null }),

      saveSessionProgress: (id, beat, answers) =>
        set((st) => ({
          sessions: {
            ...st.sessions,
            [id]: { ...(st.sessions[id] ?? { done: false }), beat, answers, done: false },
          },
        })),

      completeSession: (def, extracted, astral) => {
        const ts = Date.now();
        set((st) => ({
          fields: { ...st.fields, ...extracted.fields },
          notes: [...st.notes, ...extracted.notes.map((n) => ({ ...n, session: def.id, ts }))],
          // only overwrite the card when this session produced one — a failed
          // extraction must not wipe the reading earlier sessions earned
          astral: astral ?? st.astral,
          // Flag the island until the map is seen — but only if this
          // completion actually OPENED it. The first island is unlocked from
          // launch, so finishing its session opens nothing new and must not
          // claim otherwise.
          unseenIsland: islandOpensWith(def.id) ? def.id : st.unseenIsland,
          sessions: {
            ...st.sessions,
            [def.id]: {
              beat: def.beats.length,
              answers: st.sessions[def.id]?.answers ?? [],
              done: true,
              completedAt: ts,
            },
          },
        }));
        // reward: bond growth + coins, via the existing persisted stores
        useBond.getState().addBond(def.bond);
        useEconomy.getState().addCoins(def.coins);
      },

      isSessionDone: (id) => coreIsSessionDone(get().sessions, id),
      isSessionStartable: (id) => coreIsSessionStartable(get().sessions, id),
      nextSession: () => coreNextSession(get().sessions),
      sessionInProgress: () => coreSessionInProgress(get().sessions),

      resetSessions: () => set({ sessions: {}, unseenIsland: null }),
      resetGuidedChats: () => set({ sessions: {}, fields: {}, notes: [], astral: null, unseenIsland: null }),
    }),
    {
      name: 'sidekick_context_v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (st) => ({
        fields: st.fields,
        notes: st.notes,
        sessions: st.sessions,
        astral: st.astral,
        unseenIsland: st.unseenIsland,
      }),
    },
  ),
);
