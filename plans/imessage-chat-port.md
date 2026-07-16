# Port the imessage-llm chat into sidekick

Source: `~/Downloads/imessage-llm` — the polished iMessage UI (tapbacks, replies,
swipe-to-reply + reply-focus, voice, iOS 26 Liquid Glass). **Not** `cje/chat-stuff`,
which never had these.

## Phase 1 — Faithful copy ✅ done, verified in sim against the source app

- `src/imessage/**` copied byte-for-byte (`diff -r` = zero), plus its chat route.
- Verified live: `+` drawer, tapback pill + badge, swipe-to-reply → reply-focus,
  voice recorder (live waveform → preview → send).
- **NativeWind gotcha:** its css-interop silently drops FUNCTION-form `Pressable`
  styles (`style={({pressed}) => …}`), which nuked `flexDirection: row` in
  `ConversationRow`. Fixed at 3 sites via `onPressIn`/`onPressOut` state. The
  source app has no NativeWind, so it could use the function form freely.
- **Not a bug:** the PlusDrawer's `GlassView` renders with no backdrop — the
  source app does the same on this sim. Liquid Glass sim limitation; check device.

## Phase 2 — Massage ✅ done

Decisions (Chris): **single thread** (no list/compose) + **server is source of truth**.

- Entry: dock Messages → `app/messages.tsx` → `<ChatScreen/>` straight into the
  Sidekick thread. Old `ChatSheet` overlay removed from the home screen.
- Data layer: `useSidekickChat` (React Query) + `imessage/server.ts` map the
  transcript to/from `chat.history` / `/chat/stream`, with an optimistic outgoing
  bubble until the turn settles. Local zustand store + client-side Anthropic key
  are **gone** (no model key ships in the app anymore).
- Backend (delegated to Codex, `plans/chat-backend-brief.md`): `messages.reply_to_id`
  (FK, ON DELETE SET NULL), `messages.reactions` jsonb, `attachments.waveform`
  jsonb; new `chat.react` / `chat.deleteMessage` (both authorized); `replyToId`
  persisted through send + stream; 6 new PGlite tests.
- Deleted: old chat (`features/chat` UI, `useChat`, ChatSheet/ChatComposer/
  ThreadMessage/bubbles/…), `expo-av`, `@anthropic-ai/sdk`, metro `node:*` stub.
  `features/chat` now holds only infra the new chat uses (device-tools,
  focus-device-tools, stream-frames).

Verified end-to-end in the sim on the real backend: send → real streamed reply →
persisted; tapback → `reactions` jsonb in Postgres, still there after a cold
restart; swipe-to-reply → `reply_to_id` set, quote renders.
`pnpm typecheck` clean, `pnpm test` 278 passing.

## Known gaps — old chat surfaced these, the new one does not (yet)

The server still produces all of it; only the chat UI stopped rendering it.
Decide what to bring across into the iMessage chat:

- **Web-search chrome** — the "looking it up…" caption + source pills.
- **Attachments** — image/file bubbles. The `+` drawer's Camera/Photos/Files
  items are inert (source app never wired them); only Audio works.
- **Sponsored cards / ads**, **documents**, **chat search / jump-to-date**.
- Deleted their now-orphaned client tests (`mobile-tool-chrome`,
  `mobile-attachments`, and 3 client assertions in `web-search.test.ts`);
  the server-side web-search tests were kept.
- Status bar is still `light` at the root — reads poorly on the white chat.
