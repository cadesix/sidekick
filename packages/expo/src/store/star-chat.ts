import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  advancePhase,
  applyTurn as coreApplyTurn,
  initConvoState,
  type ConvoState,
  type ControllerTurn,
  type PersonalityArtifact,
} from '@sidekick/core';

import { useGoals } from './goals';

// Persisted state for the Star Chat conversation (docs/STAR-CHAT.md). Holds the
// generative-with-a-floor ConvoState (phase + per-field confidence), the message
// log (so a user can dive out and resume), and the final artifact.
//
// This is the conversation state only. The persistent PROFILE that the rest of
// the app reads (fields, the astral card, bond, island unlocks) lives in the
// context store — the runner writes there at each chapter boundary via
// completeSession. NOTE: the plan's end state is BOTH artifacts server-side
// (memory file + ad profile); this client slice keeps the memory-side fields
// on-device so the flow runs now. The ad profile is NOT derived here.

export type StarChatMsg = { role: 'bot' | 'user'; text: string };

type StarChatStore = {
  convo: ConvoState | null;
  msgs: StarChatMsg[];
  artifact: PersonalityArtifact | null;
  done: boolean;

  // begin (idempotent): seed ConvoState from the funnel goals if we haven't
  // started yet, so goal arrives pre-known and never re-asked.
  start: () => void;
  pushMsg: (m: StarChatMsg) => void;
  // functional age gate: under-18s still get the experience but are excluded
  // from the (server-side, later) ad-profile pipeline.
  setAge: (band: string) => void;
  applyTurn: (turn: ControllerTurn) => void;
  advance: () => void;
  finish: (artifact: PersonalityArtifact | null) => void;
  reset: () => void;
};

export const useStarChat = create<StarChatStore>()(
  persist(
    (set, get) => ({
      convo: null,
      msgs: [],
      artifact: null,
      done: false,

      start: () => {
        if (get().convo) return; // resume — don't wipe an in-progress conversation
        const goals = useGoals.getState().chosen;
        set({ convo: initConvoState({ goals }), msgs: [], artifact: null, done: false });
      },

      pushMsg: (m) => set((s) => ({ msgs: [...s.msgs, m] })),

      setAge: (band) => set((s) => (s.convo ? { convo: { ...s.convo, ageBand: band } } : {})),

      applyTurn: (turn) =>
        set((s) => (s.convo ? { convo: coreApplyTurn(s.convo, turn) } : {})),

      advance: () => set((s) => (s.convo ? { convo: advancePhase(s.convo) } : {})),

      finish: (artifact) => set({ artifact, done: true }),

      reset: () => set({ convo: null, msgs: [], artifact: null, done: false }),
    }),
    {
      name: 'sidekick_starchat_v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ convo: s.convo, msgs: s.msgs, artifact: s.artifact, done: s.done }),
    },
  ),
);
