# 08 — Continuous Chat Thread & Hidden Compaction

The sidekick relationship is **one endless conversation per user** — no "new chat" button, no sessions, no visible seams. The user scrolls up through months of history like iMessage. Meanwhile the LLM never sees more than ~13k input tokens per turn, because the context we send is a *derived view*: a rolling summary of everything old + the recent messages verbatim. Compaction happens asynchronously, server-side, and is **completely invisible** — no message is ever deleted, edited, or hidden from the user, and nothing in the UI ever says "conversation compacted."

## Three invariants (the whole design hangs on these)

1. **`messages` is append-only and immutable.** Nothing ever updates or deletes a message row. Compaction writes to a *separate* table. The full thread is always in the DB and always scrollable.
2. **The LLM context is a derived view, rebuilt from the DB every turn.** `persona prompt + memory block + rolling summary + verbatim tail`. Summaries are disposable derived data — because source messages are immutable, any summary can be rebuilt from scratch (e.g. after a prompt improvement) by re-running compaction over full history. Never treat a summary as a source of truth.
3. **The client never sees compaction artifacts.** Summaries are never sent to the app. The thread API is plain cursor pagination over `messages`. If compaction stopped working entirely, users would notice nothing (our LLM bill would).

## Data model

`messages` as in [01-architecture.md](01-architecture.md), plus one column and one new table:

```ts
messages: {
  id /* bigserial — monotonic, used as cursor & watermark */,
  conversationId, role /* user|assistant|tool */, content,
  toolCalls jsonb, adUnitId nullable,
  tokenEstimate /* int, Math.ceil(content.length / 4), computed at insert */,
  promptVersion, model, tokensIn, tokensOut, createdAt
}

conversationSummaries: {
  id, conversationId,
  coversToMessageId,   // watermark: summarizes every message with id <= this
  content,             // the rolling summary text (structured, see below)
  tokenEstimate,
  supersedesId,        // previous summary row this one absorbed (audit chain, like memories)
  model, promptVersion, createdAt
}
// index: (conversationId, id desc) — "latest summary" is one indexed lookup
```

Monotonic bigserial message ids matter: they are simultaneously the pagination cursor, the compaction watermark, and the extraction watermark from [user-memory.md](user-memory.md) — one ordering, no timestamp ambiguity.

Constants (tune later, start here):

```ts
const TAIL_TARGET_TOKENS = 8_000;   // low watermark: what compaction trims the tail down to
const TAIL_MAX_TOKENS   = 24_000;   // high watermark: safety valve, forces mid-session compaction
const SUMMARY_MAX_TOKENS = 800;     // rolling summary hard cap
```

## Context assembly (every chat turn)

Built server-side per request, in this exact order, with Anthropic cache breakpoints (via AI SDK `providerOptions.anthropic.cacheControl`):

```
[1] persona prompt (packages/shared/prompts, versioned)          ← breakpoint A
[2] memory block (user-memory.md §3)
[3] === EARLIER IN THIS CONVERSATION ===
    <latest summary content, or omit the whole block if none>   ← breakpoint B
[4] verbatim messages WHERE id > coversToMessageId (the tail)
[5] the new user message
```

Cache behavior this buys: breakpoint A never invalidates (persona changes only on deploy). Breakpoint B invalidates when `memory_version` bumps (a `log_checkin` mid-chat — about once/day, accept it) or when a new summary lands (once every 1–3 days, and almost always while the cache is cold anyway, see triggers). Between invalidations, every turn is a ~90%-cached read of [1–4] plus the new tokens.

Two rules that keep the cache warm, write them into the renderer:

- **Date, never time.** The memory block says "today is friday, july 3" — never the clock time, or the prefix changes every turn and nothing ever hits cache.
- **Relative-date strings only change at local midnight.** "yesterday"/"in 9 days" recompute once per day; that daily invalidation is unavoidable and fine.

What's **excluded** from the LLM view (but stored and rendered to the user normally):

- Sponsored/ad messages (`adUnitId` not null) — never in the tail, never summarized. The model must not learn to talk about ads.
- Nothing else. Cron check-in openers, tool calls/results, everything the user saw is context.

## Compaction engine

### Triggers — idle-first, safety-valve second

**Primary: the session-idle job.** The same trigger as memory extraction (no message for 30 min, or user's local end-of-day — user-memory.md §2). At idle, the Anthropic prompt cache (5-min TTL) is already cold, and nobody is waiting on a reply — so compacting here is free: zero user-visible latency, zero wasted cache. The job runs **extraction first, then compaction** (ordering rule below), and only compacts if the tail exceeds `TAIL_TARGET_TOKENS`.

**Safety valve: post-turn check.** After persisting each assistant reply, if `sum(tokenEstimate)` of the tail exceeds `TAIL_MAX_TOKENS` (a single marathon session), enqueue compaction immediately. It still runs async — the *next* turn just picks up whichever summary row is latest. Never compact synchronously in the request path.

With an 8k→24k hysteresis gap, mid-session compaction is rare and each compaction buys thousands of turns of warm cache. This is deliberately not per-turn "rolling after every message" — that would invalidate breakpoint B constantly and triple LLM spend for nothing.

### Ordering rule (do not skip this)

**The compaction watermark must never pass the extraction watermark.** `coversToMessageId <= last_extracted_message_id`, enforced in code. Otherwise a durable fact could be squeezed out of the summary before the memory extractor ever saw the verbatim text, and it would be lost forever. Sequencing extraction → compaction inside one idle job makes this automatic; the assertion is the backstop.

### Boundary selection

The new watermark must land on a clean seam:

1. Compute the ideal cut: newest message id such that the remaining tail ≈ `TAIL_TARGET_TOKENS`.
2. Walk *backward* (older) from the ideal cut to the nearest acceptable boundary: a point where the **next** message is a `user` message or a cron check-in opener. Prefer a check-in opener (a natural day boundary) if one exists within ~2k tokens of the ideal cut.
3. Never split an assistant tool-call from its tool result, and never cut between a user message and the reply it got.

### The compaction call

One cheap-model call. Input: current memory block + latest summary (or "none") + the messages between the old and new watermarks. Output: the **complete replacement summary** (it absorbs the old one — we don't chain summary fragments). Insert with `supersedesId` = old summary id.

The prompt, verbatim (keep in `packages/shared/prompts/compaction.ts`, versioned):

```
You maintain the sidekick's short-term memory of one continuous friendship-chat.
Rewrite the running summary to absorb the new messages. Output ONLY the summary,
in second person ("you promised…"), under 800 tokens, using exactly these sections:

RECENT ARC — 2-4 sentences: what the last stretch of conversation has been about,
  the user's mood trajectory, anything mid-discussion.
OPEN LOOPS — things left unresolved that a good friend would follow up on.
PROMISES YOU MADE — anything you said you'd do or remember.
RUNNING BITS — inside jokes, nicknames, recurring references, tone calibrations.
ALREADY COVERED — advice given and stories told, so you never repeat them.

Rules:
- DO NOT restate facts from LONG-TERM MEMORY below — that block is always in your
  context separately. Your job is conversational texture, not biography.
- Prefer dropping the oldest, least-alive items to stay under the cap.
- Resolved loops and kept promises get deleted, not marked done.
- Never invent; if unsure whether something was said, leave it out.

LONG-TERM MEMORY (for dedup only):
{memory block}

CURRENT SUMMARY:
{latest summary or "(none yet)"}

NEW MESSAGES:
{messages old_watermark+1 .. new_watermark, "user:"/"you:" prefixed}
```

### Division of labor vs. the memory system

These two systems must not duplicate each other. The test: *would this matter in a week?*

| | Rolling summary (this doc) | Memory (user-memory.md) |
| --- | --- | --- |
| Holds | Conversational texture: open loops, promises, running jokes, recent arc, already-given advice | Durable facts: identity, people, interests, events, preferences |
| Lifespan | Days; items fall off as they resolve | Months–years; supersession chain |
| Written by | Compaction job (idle) | Extraction job (idle, runs first) |
| Rendered as | `EARLIER IN THIS CONVERSATION` block | `WHAT YOU KNOW ABOUT {NAME}` block |
| User-visible | Never | "What my sidekick knows" screen |

If the compactor keeps writing durable facts into summaries, that's an extraction gap — fix the extractor, don't grow the summary.

### Concurrency

- The compactor reads only immutable rows, so a user chatting *during* compaction is safe: their in-flight turn used the old summary + longer tail — a valid, just costlier, view.
- Apply with optimistic concurrency: inside a transaction, re-read the latest summary id; if it isn't the `supersedesId` we built against, discard and let the next idle tick retry. (Two idle triggers racing is the only writer conflict possible.)
- One compaction in flight per conversation: take a `pg_advisory_xact_lock(conversationId)` for the read-build-insert.

## Client thread UX (the "infinite scroll" side)

- **API:** `chat.history({ cursor?: messageId, limit: 50 })` → messages with `id < cursor`, newest-first. Plain keyset pagination on the bigserial id — no offset, no timestamps.
- **List:** inverted `FlatList` (see 06-design-system §5.5): newest at the visual bottom, `onEndReached` (which is the visual *top* when inverted) fetches the next older page and appends. React Query `useInfiniteQuery`, `getNextPageParam: last page's oldest id`.
- **Day separators** rendered client-side from `createdAt` (small centered `text-caption text-ink/40` label, "Yesterday", "Mon, Jun 29"), exactly like iMessage — this is what makes months of history feel navigable. Spec in 07-screen-specs §2.
- **New messages** (streaming reply, cron openers arriving while app is open) append at the bottom; scroll position is preserved automatically by the inverted list. No `maintainVisibleContentPosition` hacks needed for prepends since older pages append at the list's end.
- Opening the chat sheet loads page 1 (last 50) instantly from React Query cache, then revalidates. Deep history only loads if the user actually scrolls up.
- **Message search (Phase 2):** Postgres full-text search — a generated `tsvector` column on `messages.content` with a GIN index, `chat.search({ query })` returning matches newest-first. UI: a search icon in the chat sheet header → full-screen list of match snippets (message text with the hit bolded, day label, `text-caption` styling per 06); tapping a result opens the thread *at that message* via the around-endpoint below, with the matched bubble briefly highlighted (`bg-sun/30` fade-out over 600ms, Reanimated). No fuzzy/semantic search — FTS on an immutable table is one migration and zero infra.
- **Jump-to-date (Phase 2, ships with search):** `chat.historyAround({ messageId, span: 25 })` returns the message plus 25 on each side; the thread list supports entering "centered" mode where both directions paginate (older via `onEndReached` as usual, newer via a `onStartReached` fetch until it rejoins the live tail). Long-pressing a day separator opens a native date picker scoped to the thread's date range; picking a day jumps to that day's first message. The centered-mode list is the only genuinely fiddly part — build it once for search and jump-to-date shares it.

## Failure modes & ops

- **Compaction call fails:** retry ×3 with backoff, then alarm. Until it succeeds the app is *correct but costlier* — old summary + longer tail. There is no user-facing failure state.
- **Runaway tail** (compaction broken for days): at 100k tokens of tail, truncate the oldest verbatim messages from the *LLM view only* (never the DB) and page the on-call. This is a circuit breaker, not a feature.
- **Bad summary shipped** (prompt regression): summaries are derived — supersede with a full rebuild from message history (chunked oldest-first re-compaction). Keep this as a one-off admin script from day one.
- **Metrics:** tail token size at request time (histogram), compactions/user/week, summary tokenEstimate, time-from-trigger-to-applied, % turns served with a summary present.
- **Evals** (same harness as memory goldens): (1) *retention* — plant a promise/open loop 120 messages back in a fixture transcript, compact, LLM-judge that the summary carries it; (2) *dedup* — assert the summary doesn't restate planted memory-block facts; (3) *staleness* — resolved loops from the fixture must be absent. Run on every compaction-prompt change.

## Cost math (why this shape)

Steady-state per turn: persona ~2k + memory ~2.5k + summary ~0.8k + tail ~8k ≈ **13k input tokens**, of which [1–4] is cache-hit priced (10%) on almost every turn → effective ~2–3k full-price tokens/turn. Compare: no compaction is 50–200k tokens/turn within months and degrades quality ([context rot / lost-in-the-middle](https://pristren.com/blog/llm-context-management-strategies/)); per-turn summarization pays a cache re-write every message. Compaction itself: one cheap-model call per user per ~1–3 days. This is the whole reason the product can afford daily free chat.

## Implementation

1. `tokenEstimate` column + `conversationSummaries` table + latest-summary lookup: **0.5d**
2. Context assembler: summary block injection + cache breakpoints + ad/date rules: **1d**
3. Compaction job: boundary selection, prompt, optimistic apply, extraction-ordering, safety-valve enqueue: **1.5d**
4. `chat.history` pagination + inverted-list infinite scroll + day separators: **1d**
5. Rebuild-from-scratch admin script + metrics: **0.5d**
6. Eval goldens (retention/dedup/staleness): **1d**
7. Search + jump-to-date (FTS migration, around-endpoint, centered-mode list, search UI): **2.5d** — Phase 2

Ships in Phase 1–2 with the chat pipeline; the app works without it (small tail) so it can land a week after first chat does.
