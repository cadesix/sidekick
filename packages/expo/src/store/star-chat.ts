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
  // false until AsyncStorage rehydrates; the runner waits for it before start()
  // so a cold-launch open can't clobber an in-progress persisted conversation.
  hydrated: boolean;

  // begin (idempotent): seed ConvoState, warm-starting from the user's chosen
  // goal slugs (from the server goals list) so goal arrives pre-known.
  start: (goals?: string[]) => void;
  pushMsg: (m: StarChatMsg) => void;
  applyTurn: (turn: ControllerTurn) => void;
  advance: () => void;
  finish: (artifact: PersonalityArtifact | null) => void;
  reset: () => void;
  // DEV-only (DevPanel): jump straight to the end state so the astral-card reveal
  // sequence can be previewed without chatting through every chapter.
  devSeedArtifact: () => void;
  // a surface that can't render the star chat itself (Profile's astral CTA)
  // asks Home to open it; Home consumes the flag on its next render. Transient —
  // excluded from partialize, so it can't fire again on a later cold start.
  openRequested: boolean;
  requestOpen: () => void;
  clearOpenRequest: () => void;
};

// a full sample card for the dev jump-to-reveal (archetype + traits + reading +
// evidence insights), so the modal layout can be eyeballed with real-ish content.
const DEV_SAMPLE_ARTIFACT: PersonalityArtifact = {
  archetype: 'the quiet strategist',
  reading:
    "you read the room before you commit, watching more than you let on. under the calm there's real drive, you just don't need an audience for it. when you care about something you go all in, quietly and completely.",
  traits: ['observant', 'driven', 'self-contained', 'loyal'],
  insights: [
    { claim: 'you lead with your head', because: 'you weighed big decisions like a spreadsheet before moving' },
    { claim: 'you recharge alone', because: 'you said people are great but you need your own time to reset' },
    { claim: "you're quietly competitive", because: 'proving people wrong came up more than once' },
  ],
};

export const useStarChat = create<StarChatStore>()(
  persist(
    (set, get) => ({
      convo: null,
      msgs: [],
      artifact: null,
      done: false,
      hydrated: false,
      openRequested: false,
      requestOpen: () => set({ openRequested: true }),
      clearOpenRequest: () => set({ openRequested: false }),

      start: (goals = []) => {
        if (get().convo) return; // resume — don't wipe an in-progress conversation
        set({ convo: initConvoState({ goals }), msgs: [], artifact: null, done: false });
      },

      pushMsg: (m) => set((s) => ({ msgs: [...s.msgs, m] })),

      applyTurn: (turn) =>
        set((s) => (s.convo ? { convo: coreApplyTurn(s.convo, turn) } : {})),

      advance: () => set((s) => (s.convo ? { convo: advancePhase(s.convo) } : {})),

      finish: (artifact) => set({ artifact, done: true }),

      reset: () => set({ convo: null, msgs: [], artifact: null, done: false }),

      devSeedArtifact: () =>
        set({
          convo: initConvoState({}), // non-null so the runner resumes instead of re-opening
          msgs: [
            { role: 'bot', text: "ok that's everything i wanted to ask ✦" },
            { role: 'bot', text: 'let me pull your reading together…' },
          ],
          artifact: DEV_SAMPLE_ARTIFACT,
          done: true,
        }),
    }),
    {
      name: 'sidekick_starchat_v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ convo: s.convo, msgs: s.msgs, artifact: s.artifact, done: s.done }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);
