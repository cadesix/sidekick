import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
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

export type SidekickContext = {
  fields: Record<string, string>;
  notes: ContextNote[];
  sessions: SessionsState;

  // persist progress after every answer so the user can dive out and back in
  saveSessionProgress: (id: string, beat: number, answers: string[]) => void;
  // merge extracted fields + notes, mark done, and pay bond + coins
  completeSession: (def: SessionDef, extracted: Extracted) => void;

  // selectors mirroring the core ladder helpers over this store's `sessions`
  isSessionDone: (id: string) => boolean;
  isSessionStartable: (id: string) => boolean;
  nextSession: () => SessionDef | undefined;
  sessionInProgress: () => { def: SessionDef; state: SessionState } | null;
};

export const useSidekickContext = create<SidekickContext>()(
  persist(
    (set, get) => ({
      fields: {},
      notes: [],
      sessions: {},

      saveSessionProgress: (id, beat, answers) =>
        set((st) => ({
          sessions: {
            ...st.sessions,
            [id]: { ...(st.sessions[id] ?? { done: false }), beat, answers, done: false },
          },
        })),

      completeSession: (def, extracted) => {
        const ts = Date.now();
        set((st) => ({
          fields: { ...st.fields, ...extracted.fields },
          notes: [...st.notes, ...extracted.notes.map((n) => ({ ...n, session: def.id, ts }))],
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
    }),
    {
      name: 'sidekick_context_v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (st) => ({ fields: st.fields, notes: st.notes, sessions: st.sessions }),
    },
  ),
);
