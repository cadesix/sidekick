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
  // sidekick-initiated pushes (map arrivals etc.) bump this; the dock Messages
  // tile badges it until the chat is opened. Mirrors sidekick-inbox.ts.
  unread: number;
  send: (text: string) => Promise<void>;
  // append a sidekick line outside a live chat + bump unread
  pushSidekickMessage: (text: string) => void;
  clearUnread: () => void;
  reset: () => void;
};

export const useChat = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [GREETING],
      loading: false,
      unread: 0,
      send: async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || get().loading) return;
        const next: Msg[] = [...get().messages, { role: 'user', content: trimmed }];
        set({ messages: next, loading: true });
        const reply = await fetchReply(next);
        set((st) => ({ messages: [...st.messages, { role: 'assistant', content: reply }], loading: false }));
      },
      pushSidekickMessage: (text: string) =>
        set((st) => ({
          messages: [...st.messages, { role: 'assistant', content: text }],
          unread: st.unread + 1,
        })),
      clearUnread: () => set((st) => (st.unread === 0 ? st : { unread: 0 })),
      reset: () => set({ messages: [GREETING], loading: false, unread: 0 }),
    }),
    {
      name: 'sidekick_chat_v1',
      storage: createJSONStorage(() => AsyncStorage),
      // don't persist the transient loading flag
      partialize: (st) => ({ messages: st.messages, unread: st.unread }),
    },
  ),
);
