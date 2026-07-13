# User Memory Architecture

How Sidekick builds, stores, uses, and monetizes an evolving understanding of each user.

## Context & constraints

- Today: Vite web prototype (`src/chat.tsx`, `api/chat.js` → OpenAI `gpt-5.5`, system prompt in `src/sidekick-prompt.ts`). Target: Expo app with a real backend.
- Onboarding (`src/components/funnel/`) already collects: name, age bracket, gender, goals (slugs like `get-fit`, `sleep-better`), and a 20-item Big Five test scored into OCEAN percents + a branded archetype (`personality.ts`).
- This is a **small-context problem**. One user's entire profile — demographics, goals, dozens of interests, months of episodic events — fits comfortably in 1.5–3k tokens. A year of heavy use, with compaction, stays under ~4k. So the design is: **one Postgres-backed profile, rendered fully into the system prompt every turn**. No vector DB, no RAG, no embeddings. The point where retrieval becomes worth it is when a rendered profile can't be compacted below ~8–10k tokens — realistically multiple years of daily use, and even then summarization is the first lever, not vectors.

- **Sibling system:** [08-chat-thread-compaction.md](08-chat-thread-compaction.md) owns the *conversational* short-term layer (rolling summary of the endless thread). Division of labor: memory = durable facts about the user (matters in a week); the rolling summary = thread texture (open loops, promises, running jokes). The two share the idle-trigger job — **extraction always runs before compaction**, so no fact can be squeezed out of the verbatim transcript before the extractor has seen it.

Assumed backend for v1: the Vercel deployment we already have + Postgres (Neon or Supabase). Nothing below depends on that choice.

---

## 1. Memory data model

Two layers, deliberately separated:

1. **Typed tables** for state the app itself renders and mutates deterministically: user identity, goals, daily check-ins. These are product data, not "memories" — they have UI, streaks, and analytics hanging off them.
2. **One `memories` table** for everything the sidekick *learns from conversation*: freeform facts with a kind, confidence, provenance, and a supersession chain. Freeform because the interesting stuff ("her dog is named biscuit", "starts a new job at figma monday") never fits a fixed schema; one table because a zoo of typed memory tables is the classic over-engineering trap here.

### Schema

```sql
create table users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  age_bracket   text not null,          -- 'under-18' | '18-24' | ... (funnel values)
  gender        text not null,          -- 'female' | 'male' | 'non-binary' | 'prefer-not'
  timezone      text not null default 'America/New_York',
  personality   jsonb not null,         -- { archetype, tagline, percents: {O,C,E,A,N} }
  sidekick_name text not null,
  memory_version bigint not null default 1,  -- bumped on ANY memory/goal/checkin write
  created_at    timestamptz not null default now()
);

create table goals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id),
  slug       text not null,             -- 'get-fit', 'sleep-better', ...
  label      text not null,
  action     text,                      -- chosen action item, e.g. 'run'
  cadence    jsonb not null,            -- { type: 'per_week', target: 3 } | { type: 'daily', criteria: 'asleep by 11:30pm' }
  status     text not null default 'active',  -- active | paused | completed | abandoned
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table checkins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id),
  goal_id    uuid not null references goals(id),
  date       date not null,             -- user-local date
  result     text not null,             -- hit | missed | partial | skipped
  note       text,                      -- 'ran 3mi, knee sore'
  source     text not null default 'chat',   -- chat | manual
  created_at timestamptz not null default now(),
  unique (goal_id, date)
);

create type memory_kind as enum (
  'identity',      -- stable facts: hometown, living situation, siblings
  'work_school',   -- job, company, school, major, coworkers
  'relationship',  -- partner, friends, family, pets — named people in their life
  'schedule',      -- routines: 'gym after work tue/thu', 'free most sundays'
  'interest',      -- music, teams, shows, hobbies, brands, food
  'preference',    -- how they like to be talked to, pet peeves, motivators
  'event',         -- dated episodic: 'first day at new job', 'marathon on oct 12'
  'emotional',     -- patterns: 'stress spikes before deadlines', 'sundays are low'
  'goal_context'   -- color around goals: 'hates morning workouts', 'reads on train'
);

create table memories (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id),
  kind               memory_kind not null,
  content            text not null,      -- one plain sentence, third person: "works as a nurse at UCSF, night shifts"
  event_date         date,               -- only for kind='event' (past or future)
  confidence         text not null default 'stated',  -- stated | inferred
  status             text not null default 'active',  -- active | superseded | expired | deleted
  supersedes_id      uuid references memories(id),    -- contradiction chain
  source             text not null,      -- onboarding | extraction | user_edit
  source_session_id  uuid,               -- which conversation produced it
  last_reinforced_at timestamptz not null default now(),
  created_at         timestamptz not null default now()
);
create index on memories (user_id, status, kind);

-- Tombstones: things the user deleted that the extractor must never re-learn.
create table memory_suppressions (
  user_id    uuid not null references users(id),
  content    text not null,              -- the deleted memory's content, matched by the extractor
  created_at timestamptz not null default now()
);
```

Design notes:

- **`content` is a single plain-English sentence, third person.** This is the load-bearing decision: the write path (LLM extraction), the read path (prompt rendering), dedup (the extractor compares sentences), and the user-facing memory screen all operate on the same human-readable string. No JSONB attribute bags to keep in sync with the text — the sentence *is* the memory. Rejected: structured `attrs jsonb` per memory — every consumer would still need the sentence, and structured fields drift from it.
- **Confidence is two-valued** (`stated` = user said it, `inferred` = sidekick deduced it), not a float. Nobody can calibrate 0.73 vs 0.81; the only decision it drives is rendering ("thinks maybe…") and how easily it can be superseded.
- **Recency** = `last_reinforced_at`, touched whenever the extractor sees the fact confirmed again. Used for compaction ordering, never for retrieval.
- **Contradictions are supersession, not mutation.** "Changed jobs" → new `work_school` memory with `supersedes_id` pointing at the old one; old row flips to `status='superseded'`. Full history is preserved (which also lets the sidekick say "how's the new place compared to the old team?"), and the chain is auditable on the memory screen. Rejected: in-place updates — you lose the "new" in "new job", and the drift/debugging story is much worse.
- **Events carry `event_date`** and are the fuel for great openers ("how'd your first day go?"). Future-dated events are upcoming plans; the rendering layer converts to relative time at request time.

## 2. Write path

**Recommendation: async post-conversation extraction for all memories, plus exactly one inline tool (`log_checkin`) during chat.**

Why this split: check-in outcomes must land in real time — the daily list, streak, and reward UI update mid-conversation, and the notion doc explicitly specs "infers whether you hit your goals… then calls a tool." Everything else gains nothing from being real-time and loses a lot: inline memory tools bloat the chat prompt, add latency to every reply, tempt the persona model into robotic "noted!" behavior, and produce noisy, unmergde writes. Rejected: all-inline (above problems), all-async (check-ins lag the UI), and dual-path for the same data (two writers to reconcile).

### Inline tool (chat model)

```json
{
  "name": "log_checkin",
  "description": "Record the outcome of one of the user's goals for a specific day, once the conversation makes the outcome clear. Call at most once per goal per day. Never ask the user to confirm 'should I log that' — just log it.",
  "parameters": {
    "type": "object",
    "properties": {
      "goal_id": { "type": "string", "description": "ID from the GOALS section of your context" },
      "date": { "type": "string", "format": "date", "description": "User-local date the outcome applies to, usually today or yesterday" },
      "result": { "type": "string", "enum": ["hit", "missed", "partial", "skipped"] },
      "note": { "type": "string", "description": "One short phrase of color, e.g. 'ran 3mi, knee sore'" }
    },
    "required": ["goal_id", "date", "result"]
  }
}
```

The handler upserts on `(goal_id, date)` and bumps `users.memory_version`.

### Async extraction pass

Runs when a conversation goes idle (no message for 30 min) or at the user's local end-of-day, whichever first — one cheap-model call per session, so cost is trivial. This is the same idle job that then runs thread compaction (08 §triggers); extraction goes first and advances `last_extracted_message_id`, which is the ceiling the compaction watermark may never pass. The extractor receives:

1. The user's **current active memories** (id + kind + content) — this is what makes dedup work: it must reference existing IDs instead of re-adding.
2. The **suppression list** (never re-learn these).
3. The **new transcript** since the last extraction watermark (store `last_extracted_message_id` per conversation).

It returns one structured output:

```json
{
  "name": "apply_memory_ops",
  "description": "Update the user's long-term memory from this conversation. Only record things worth remembering in a week. Prefer reinforce/supersede over add when an existing memory covers the same fact.",
  "parameters": {
    "type": "object",
    "properties": {
      "ops": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "op": { "type": "string", "enum": ["add", "supersede", "reinforce", "expire"] },
            "memory_id": { "type": "string", "description": "Existing memory ID; required for supersede/reinforce/expire" },
            "kind": { "type": "string", "enum": ["identity", "work_school", "relationship", "schedule", "interest", "preference", "event", "emotional", "goal_context"] },
            "content": { "type": "string", "description": "One plain third-person sentence. Required for add/supersede." },
            "event_date": { "type": "string", "format": "date" },
            "confidence": { "type": "string", "enum": ["stated", "inferred"] }
          },
          "required": ["op"]
        }
      }
    },
    "required": ["ops"]
  }
}
```

Server-side application rules:

- `add` → insert; first check `memory_suppressions` (fuzzy match by the extractor already, exact-ish match server-side as a backstop) and skip if suppressed.
- `supersede` → insert new row with `supersedes_id`, flip old row to `superseded`.
- `reinforce` → touch `last_reinforced_at` (and upgrade `inferred` → `stated` if the extractor says so via a paired `confidence`).
- `expire` → for events that have passed and yielded their follow-up, or facts the user disavowed ("i don't really watch that anymore").
- Every applied batch bumps `memory_version` once.

Extraction prompt guardrails worth writing explicitly: max ~8 ops per session; don't record message-level trivia ("said good morning"); don't record sensitive-category facts as `interest` (health conditions, sexuality, religion, politics go to `emotional`/`identity` only if clearly useful for support, and are excluded from ad projection — see §5); events need a date or they're `goal_context`.

## 3. Read path

**Recommendation: render the entire active profile into the system prompt on every request.** Token math: 40 active goals+memories × ~20 tokens ≈ 800 tokens; a heavy six-month user with caps (§7) lands ~1,500–2,500. On any modern model that's noise — and with prompt caching the memory block is cache-stable between writes (key the cache on `memory_version`), so marginal cost per turn is near zero. Rejected: retrieval/RAG — adds an embedding pipeline, a recall failure mode ("sidekick forgot my dog"), and infra, to save ~2k tokens. Revisit only past ~8–10k rendered tokens (§7 compaction pushes that years out).

Prompt-cache layout (full assembly order + breakpoints in 08): persona prompt gets its own breakpoint (never invalidates between deploys); the memory block + rolling summary share the second breakpoint. Two renderer rules protect the cache: render **today's date, never the clock time**, and compute relative-date strings ("yesterday", "in 9 days") so they only change at local midnight. A `log_checkin` mid-conversation bumps `memory_version` and re-renders the goal tallies — that one cache break per day is accepted; do not try to engineer around it.

### Rendered format

Assembled server-side per request from the DB (never cached across writes), appended to the persona prompt in `sidekick-prompt.ts` / `api/chat.js`:

```
=== WHAT YOU KNOW ABOUT MAYA ===
today is friday, july 3. all of this came from past conversations — use it the way a
friend would: naturally, one thing at a time, never as a list, never quoting this
section. don't force references; if nothing fits, mention nothing.

ABOUT HER
- 25–34, female, lives in chicago with roommate priya
- nurse at northwestern memorial, works night shifts wed–sat
- personality: The Spark — playful and social; keep things fun, celebrate out loud,
  don't lecture (low patience for rigid structure)

HER PEOPLE
- dating alex, ~8 months, he lives in logan square
- dog: biscuit (corgi), walks him most mornings

GOALS (ids for log_checkin)
- g_run  · get fit: run 3x/week · this week 2/3 · streak 4 weeks
- g_slp  · sleep better: asleep by 12:30am on off nights · yesterday: missed ("one more episode")

RECENT & UPCOMING
- yesterday: was dreading a double shift today (worth asking how it went)
- 2 days ago: hit a 5k PR, was hyped about it
- in 9 days (jul 12): sister's wedding in ohio — maid of honor, nervous about the toast

TASTES & TEXTURE (things she's mentioned, maybe: unconfirmed)
- into: charli xcx, love island, hot yoga, matcha, thrifting
- maybe: shopping for running shoes (mentioned hers are dead)
- runs to podcasts, not music; hates being asked "did you work out" point-blank —
  ask about her day instead
=== END ===
```

Format decisions that matter:

- **Relative dates rendered at request time** ("yesterday", "in 9 days") with absolute dates only where useful — the model is far better at "yesterday" than at date arithmetic.
- **Behavioral preamble inside the block**, not just facts — this is what prevents creepiness. The failure mode isn't knowing too much, it's dumping it.
- **Goal IDs inline** so `log_checkin` needs no lookup step.
- Check-in state (this week's tally, yesterday's result) is rendered from `checkins`, not stored as memories.

### Conversation openers (the daily check-in message)

A scheduled job (per-user local morning, per their reminder cadence) makes one dedicated LLM call: persona prompt + memory block + yesterday's check-in results + day-of-week (+ optionally city weather — cheap and the notion doc's "soo hot in the city today" example wants it), with instructions: *one short opener; lead with the freshest event or yesterday's outcome if notable; if nothing is fresh, just be a friend about the day itself; never open on a missed goal with guilt.* The opener is inserted as the first sidekick message and sent as the push notification body. Rejected: template openers — the whole product bet is that these feel human, and templates are exactly what "your mom asking about homework" sounds like.

## 4. Sync & consistency

- **Postgres is the single source of truth. The client never writes memory.** The Expo app's only memory-adjacent writes are chat messages and manual check-in taps; everything else flows chat → server → extractor → DB.
- **The model's context is rendered from the DB at request time, every time.** This kills the classic drift ("the LLM said it remembered X but stored Y") structurally: the sidekick has no memory except what's in the DB. If it says something in-chat that isn't stored yet, the extraction pass captures it within the session's idle window — self-healing by construction.
- **`users.memory_version`** (monotonic, bumped on any goal/checkin/memory write) is the sync primitive: the client's `GET /me/memory` response carries it, React Query caches on it, and the chat endpoint returns the current version in each reply so the client knows to refetch the memory screen / goals UI after a `log_checkin` fired mid-chat. It's also the prompt-cache key.
- Client caching: React Query with the memory screen and goals list keyed on `['memory', memoryVersion]`; no offline mutation queue in v1 (chat requires connectivity anyway).

## 5. Ad-targeting projection (Gravity)

> **Reality check from Gravity's actual API (see [05-monetization.md](05-monetization.md)):** Gravity's matching is conversation-contextual — its ad request takes recent `messages`, device/geo signals, and hashed email, but has **no field for a demographic/interest profile**. So this projection is not transmitted to Gravity; it powers our side of the integration instead: deciding which turns are ad-eligible, `excludedTopics`, relevancy thresholds per user, and it's the ready-made profile for networks that DO take one (Koah, Nexad) and future direct deals. The consent/eligibility model below applies to all of it unchanged.

**A derived `ad_profiles` table, regenerated by a nightly job — never the raw memories.** Ad partners get a clean, bounded, taxonomy-coded document at most; raw memory (names, health, relationships, feelings) never leaves our DB.

```sql
create table ad_profiles (
  user_id      uuid primary key references users(id),
  eligible     boolean not null,        -- false: under-18 bracket, no consent, or opt-out
  age_bracket  text,
  gender       text,                    -- only if not 'prefer-not'
  region       text,                    -- coarse: metro/state, never precise location
  interests    jsonb not null default '[]',  -- IAB Content Taxonomy codes + labels
  intents      jsonb not null default '[]',  -- [{ signal: 'running-shoes', strength: 'active', expires: '2026-08-01' }]
  generated_at timestamptz not null
);

create table consents (
  user_id  uuid not null references users(id),
  kind     text not null,               -- 'personalized_ads' | 'att'
  granted  boolean not null,
  at       timestamptz not null default now()
);
```

The nightly projection job takes active `interest` + explicit purchase-intent memories and classifies them into **IAB Content Taxonomy** codes (one small-model call with the taxonomy's relevant slice; deterministic mapping table for our own goal slugs, e.g. `get-fit` → Healthy Living/Fitness). Purchase-intent signals ("running shoes are dead") get a strength and a 30–60 day TTL so stale intent doesn't linger.

Hard exclusions from projection, regardless of what memory holds: health/medical, mental & emotional state, sexuality, religion, politics, finances-distress, anything about third parties (partner, family), and all `emotional`/`relationship` kinds wholesale. Device-sourced health data (`health_days`, [12-life-integrations.md](12-life-integrations.md)) is excluded as a table, not just a category — it never feeds the projection, and health-derived assistant messages are stripped from ad-forwarded context per 12. This is both GDPR Art. 9 (special categories) hygiene and just not being gross.

Consent & compliance requirements to build in from day one:

- **Minors:** `under-18` bracket → `eligible=false`, contextual/house ads only, no profile transmitted. (COPPA if we ever allow <13 — currently the bracket floor makes this a policy question, not a code one.)
- **iOS ATT:** only required if we share device identifiers (IDFA) with Gravity. Recommendation: don't — first-party interest profiles keyed to our own user ID don't need ATT's prompt, which tanks opt-in. Confirm with Gravity's integration docs before wiring anything IDFA-shaped.
- **GDPR/CCPA:** a "personalized ads" toggle in settings (defaults per region: opt-in for EU, opt-out-available for US), a "do not sell/share" link for CCPA, and account deletion cascades through `ad_profiles` and any data pushed to Gravity (their deletion API, whatever form it takes).
- The transparency screen (§7) shows the ad profile too — "brands see: fitness, live music, coffee" builds more trust than hiding it.

## 6. Cold start

At funnel completion (`FunnelAnswers` + `computePersonality()` output), a single seed transaction writes:

- `users` row: name, age bracket, gender, personality JSON, sidekick name/color.
- `goals` rows from the goal slugs; the onboarding chat's action-item + cadence choices update `action`/`cadence` on those rows (the onboarding chat runs with the same `log_checkin`-style tooling, plus a `set_goal_plan` tool it alone gets).
- Seed `memories` with `source='onboarding'`, `confidence='stated'`: one `identity` sentence from demographics, one `preference` sentence rendered from the archetype (the coaching-style blurbs in `personality.ts` translate directly: The Spark → "keep it playful and social, don't lecture"), and one `goal_context` per goal ("chose sleep better; wants to be asleep by 12:30").
- The extraction pass **runs on the onboarding chat transcript itself** — users volunteer gold in that first guided conversation ("i always mean to run after work but i'm dead by then") and it should be remembered like anything else.

Day-1 result: the first real check-in message already knows her name, why she's here, how she wants to be talked to, and whatever she said during setup.

## 7. Ops

**Transparency & control** — a "what my sidekick knows" screen:

- `GET /me/memory` → active memories grouped by kind, plain sentences, with source ("you told me" vs "i picked this up") and date. Because memories *are* sentences, this screen is a straight render — no translation layer to maintain.
- Delete → `status='deleted'` + row in `memory_suppressions` so extraction never re-learns it. Edit → user-sourced supersession (`source='user_edit'`, `confidence='stated'` — user edits outrank everything).
- Ad profile shown on the same screen with the personalized-ads toggle.

**Size bounds & compaction** — monthly job per user:

- Caps per kind (roughly: 30 interests, 25 events, 15 each elsewhere). Over cap → evict by oldest `last_reinforced_at`.
- Past events older than ~45 days that were reinforced (i.e. mattered) get folded by a small-model call into one narrative `identity`/`goal_context` sentence per theme ("trained for and ran the chicago 10k in june; running is her anchor habit"), originals `expired`. Un-reinforced stale `inferred` memories just expire.
- Check-ins never compact (they're cheap rows and power streak/stats UI); only their *rendered window* in the prompt is bounded (this week + yesterday + streak summary).
- This keeps the rendered block ~2.5k tokens indefinitely and is exactly why per-user RAG stays unnecessary.

**Evals** — three cheap, high-leverage suites, runnable in CI against recorded fixtures:

1. **Extraction goldens:** ~30 synthetic transcripts (job change, breakup, new interest, sarcasm/hypotheticals that must NOT be recorded, suppressed-fact re-mention) → expected op sets; assert op type + target ID, LLM-judge the sentence content.
2. **Usage quality:** given a rendered profile + scenario, LLM-judge whether replies/openers use memory naturally — scored on {referenced something relevant, didn't list facts, didn't reference stale/superseded facts, not creepy}. This is the product's core feel; run it on every persona-prompt or renderer change.
3. **Consistency probe:** scripted "what do you know about me?" chat vs. DB contents — the answer must be a subset of active memories.

## 8. Implementation phasing

**V1 — memory that works (≈1 week)**
1. Postgres schema above + seed-from-onboarding transaction (0.5d)
2. Server-side prompt assembly: render memory block + goals into system prompt; move off the static prompt in `api/chat.js` (1d)
3. `log_checkin` tool wiring in the chat endpoint + checkins upsert (0.5d)
4. Async extraction pass (idle-trigger + watermark, apply-ops handler, suppression check) (1.5d)
5. Read-only "what my sidekick knows" screen + `GET /me/memory` (1d)
6. Extraction goldens eval, first ~10 cases (1d)

**V2 — memory that feels alive (≈1 week)**
1. Daily opener job + push send, with per-user local-time scheduling (1.5d)
2. Supersession polish: renderer shows "new job" framing; onboarding-chat `set_goal_plan` tool; goal pause/complete flows (1.5d)
3. Memory edit/delete UI + suppressions end-to-end (1d)
4. Compaction job + per-kind caps (1d)
5. Usage-quality eval suite (1d)

**V3 — monetization & scale (≈1 week + Gravity integration unknowns)**
1. `ad_profiles` projection job with IAB mapping + sensitive-category exclusions (1.5d)
2. Consent flows: settings toggle, region defaults, minor gating, deletion cascade (1.5d)
3. Gravity API integration per their docs (2d, ±)
4. Consistency-probe eval + weather enrichment for openers (1d)

Explicitly deferred until proven necessary: vector search / RAG (trigger: rendered profile can't compact under ~8–10k tokens), multi-device offline mutation queues, embedding-based dedup (sentence comparison by the extractor against the full active set works at this size).
