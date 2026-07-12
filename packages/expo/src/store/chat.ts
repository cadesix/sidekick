import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { fetchReply } from '../lib/chat-api';

// Chat state, mirroring sidekick/src/chat.tsx (localStorage → AsyncStorage,
// persisted under a key parallel to the web's "sidekick_chat_v1").

export type Msg = { role: 'user' | 'assistant'; content: string };

const GREETING: Msg = {
  role: 'assistant',
  content: "hey! how's your day going so far — have you had any water yet? 👀",
};

type ChatState = {
  messages: Msg[];
  loading: boolean;
  send: (text: string) => Promise<void>;
  reset: () => void;
};

export const useChat = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [GREETING],
      loading: false,
      send: async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || get().loading) return;
        const next: Msg[] = [...get().messages, { role: 'user', content: trimmed }];
        set({ messages: next, loading: true });
        const reply = await fetchReply(next);
        set((st) => ({ messages: [...st.messages, { role: 'assistant', content: reply }], loading: false }));
      },
      reset: () => set({ messages: [GREETING], loading: false }),
    }),
    {
      name: 'sidekick_chat_v1',
      storage: createJSONStorage(() => AsyncStorage),
      // don't persist the transient loading flag
      partialize: (st) => ({ messages: st.messages }),
    },
  ),
);
