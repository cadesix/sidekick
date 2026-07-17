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

// Persisted state for the onboarding conversation (docs/ONBOARDING-CONVERSATION.md).
// Holds the generative-with-a-floor ConvoState (phase + per-field confidence),
// the message log (so a user can dive out and resume), and the final artifact.
//
// NOTE: the plan's end state is BOTH artifacts server-side (memory file + ad
// profile). This client store is the first slice — it keeps the memory-side
// fields on-device so the flow is runnable/testable now; the server memory +
// ad-inference pass land later. The ad profile is NOT derived here.

export type OnboardingMsg = { role: 'bot' | 'user'; text: string };

type OnboardingStore = {
  convo: ConvoState | null;
  msgs: OnboardingMsg[];
  artifact: PersonalityArtifact | null;
  done: boolean;

  // begin (idempotent): seed ConvoState from the habit-tracker goals if we
  // haven't started yet, so goal arrives pre-known and never re-asked.
  start: () => void;
  pushMsg: (m: OnboardingMsg) => void;
  // functional age gate: under-18s still get the experience but are excluded
  // from the (server-side, later) ad-profile pipeline.
  setAge: (band: string) => void;
  applyTurn: (turn: ControllerTurn) => void;
  advance: () => void;
  finish: (artifact: PersonalityArtifact | null) => void;
  reset: () => void;
};

export const useOnboarding = create<OnboardingStore>()(
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
      name: 'sidekick_onboarding_v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ convo: s.convo, msgs: s.msgs, artifact: s.artifact, done: s.done }),
    },
  ),
);
