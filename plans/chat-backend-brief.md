# Backend brief: reactions, reply-to, voice waveform for chat

We ported a polished iMessage-style chat UI into `packages/expo/src/imessage/**`.
It supports **message reactions (tapbacks)**, **reply-to-message**, and **voice
messages with a waveform**. The server is now the source of truth for the
conversation, but our schema has none of these three things. Add them.

Scope is **backend only**: `packages/db`, `packages/shared`, `packages/server`,
and `tests/`. **Do not touch `packages/expo` or `packages/web`** — a separate
workstream owns the client and will consume exactly the contract below.

## The client's data model (what you must be able to round-trip)

```ts
type ReactionType =
  | "heart" | "thumbsUp" | "thumbsDown" | "haha" | "exclamation" | "question"
  | `emoji:${string}`;            // e.g. "emoji:🔥"
type Sender = "me" | "them";      // "me" = the user, "them" = the sidekick
interface Reaction { type: ReactionType; from: Sender; }
```

A message can carry **at most one reaction per sender** (`from`). Re-applying the
same type from the same sender **clears** it (toggle); applying a different type
**replaces** it.

## 1. DB (`packages/db/src/schema.ts` + migration)

On `messages`:
- `replyToId` → `bigint("reply_to_id", { mode: "number" })`, nullable, FK →
  `messages.id`. The message this one is a reply to.
- `reactions` → `jsonb("reactions")`, NOT NULL, default `[]`. Stores
  `Reaction[]` exactly as typed above.

On `attachments`:
- `waveform` → `jsonb("waveform")`, nullable. A `number[]` of normalized 0..1
  amplitude bars for voice messages (the client records 36 bars). Needed so the
  waveform survives a reload — today it would be lost.

Generate the migration (`pnpm db:generate`) and apply it (`pnpm db:migrate`).
A local Postgres is already running for this: `DATABASE_URL=postgres://sidekick:sidekick@localhost:55432/sidekick`.

## 2. Shared input schemas (`packages/shared`)

- Extend `chatSendInput` with optional `replyToId?: number`.
- Extend `attachmentUploadedInput` with optional `waveform?: number[]`.
- Add `chatReactInput`: `{ messageId: number; type: string | null }` —
  `type: null` clears the caller's reaction. Validate `type` against the
  `ReactionType` shape (the six named types, or `emoji:<char(s)>`).
- Add `chatDeleteMessageInput`: `{ messageId: number }`.
- Export a `ReactionType` / `Reaction` type from shared so server and client agree.

## 3. Server (`packages/server/src/routers/chat.ts`, `src/chat/turn.ts`)

- `chat.send` (and the streaming `/chat/stream` path in `src/app.ts` / `turn.ts`):
  accept `replyToId` and persist it on the **user** message row it inserts.
- `chat.history` and `chat.historyAround`: the returned rows must include
  `replyToId` and `reactions`. (They select `*` today, so adding the columns may
  be enough — verify.)
- **New** `chat.react` (protectedProcedure mutation, `chatReactInput`): applies
  the toggle/replace semantics above for `from: "me"` on that message. Must
  **authorize**: the message must belong to a conversation owned by `ctx.userId`,
  else `TRPCError({ code: "NOT_FOUND" })`. Return the updated `Reaction[]`.
- **New** `chat.deleteMessage` (protectedProcedure mutation,
  `chatDeleteMessageInput`): deletes the message (powers "Undo Send"). Same
  ownership authorization. Null out / clean up any `reply_to_id` rows pointing at
  it so the FK can't dangle.
- `attachmentUploaded`: persist `waveform` onto the attachment row when given,
  and include `waveform` wherever attachments are returned to the client
  (`attachmentsForMessages`).

Reactions are only ever set by the user right now (`from: "me"`); model-authored
reactions (`from: "them"`) are out of scope, but **do not** hardcode `"me"` into
the storage shape — keep the `Reaction[]` general.

## 4. Tests (`tests/`, vitest + PGlite, no mocks)

Follow the existing conventions in `tests/`. Cover:
- react: apply → replace with a different type → re-apply same type clears it.
- react: an `emoji:🔥` reaction round-trips.
- react / deleteMessage on **another user's** message → NOT_FOUND (authorization).
- send with `replyToId` → history returns it.
- deleteMessage removes the row and doesn't leave a dangling `reply_to_id`.
- voice attachment `waveform` round-trips through upload → history.

## Done means

`pnpm typecheck` and `pnpm test` both pass from the repo root. Follow the
repo's house style (see root `CLAUDE.md`): no `any`, no `as`, simple readable
code, reuse existing helpers (`ensureMainConversation`, `withAttachments`,
`protectedProcedure`), and no divider comments.
