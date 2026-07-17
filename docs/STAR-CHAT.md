# Star Chat — Build Plan

Status: design. Engine + runner built (a first slice); this is the spec they
implement.

Star Chat is a **guided personality reading that doubles as getting to know the
user** — a single, long, near-fully-generative conversation bounded by a hard
floor of information we must collect, ending in a personalized personality
artifact.

**This is NOT the app's initial onboarding funnel.** That funnel (goals →
habits) is a separate, untouched step that runs first (see §2A). Star Chat is the
*progressive onboarding* — "progressive" because it's long and reveals the user
progressively, not because anything paces it.

**Structure — one continuous, resumable conversation.** It moves through the ~6
chapters in a single flow. There are **no islands, no map gating, and no daily
cap** (the old 6 island-gated sessions are retired for this). Ideally the user
finishes in their first sitting; persisted state lets them break it across
sittings if they prefer. It supersedes the current scripted star-chat beats.

---

## 1. Objectives (in priority order)

1. **Make the user feel known.** The conversation seeds a per-user context/memory
   file rich enough that in sessions 1–3 the sidekick visibly *remembers* them
   and personalizes — the core retention driver. This is the top priority.
2. **Build a monetizable profile.** Collect enough to derive a valuable
   advertiser profile: socioeconomic band, household role, purchase-decision
   status, life stage, category and brand affinities, purchase intent.

**The rule that makes these reinforce instead of fight:** every commercial signal
is extracted as a *byproduct of a genuinely personal conversation*, never asked
as a market-research question. The moment it feels like a survey, objective #1
collapses (guarded answers, lower data quality) — which also poisons #2. Feel is
not in tension with monetization; it protects it.

**Corollary — most ad value is inferred, not asked.** We ask ~11 personal
anchors; the commercial dimensions are *derived* from them after the fact. Rich
profile, human conversation.

---

## 2. Two artifacts, one conversation

The same transcript feeds two separate stores. Keep them separate.

| | **Memory file** | **Ad profile** |
|---|---|---|
| Audience | user-facing | advertiser-facing |
| Content | facts, traits, tastes, goals, evidence | inferred segments + affinities |
| Transparency | showable ("here's what I remember about you") | governed, consent-gated |
| Storage | **server-side** (fetched to display) | **server-side**, never leaves the server |
| Populated by | conversational extraction | inference pass over the transcript |

**Both artifacts live server-side.** The device holds at most a display cache of
the memory file; the ad profile never touches the client. Rationale: trust is the
product. The memory file is a feature you can flaunt (and serve back cross-session
to power the "it remembers me" feel); the ad profile is back-end, consent-gated,
and off-device entirely.

---

## 2A. Warm start — what we already know

Star Chat is **not** the user's first contact. The initial onboarding funnel (the
lightweight goals/habit setup) runs first and already collects:

- **Goals** — what the user wants to work on.
- **Daily habits** — the tracker generates a habit list from those goals.

So we enter this conversation with a **prior profile**, and two things follow:

1. **Pre-seed the state; never re-ask.** Fields the prior onboarding already
   filled (goal, and anything the habits imply) start `partial`/`high`, not
   `unknown`. The controller *deepens* them instead of collecting them cold —
   which itself sells the "it already knows me" feeling. Opening a personality
   reading already holding your goal is a stronger first beat than asking for it.

2. **Goal → underlying desire is a seeded hypothesis.** A stated goal implies a
   *why*: fitness → look/feel better, confidence; read-more → be (or be seen as)
   smarter. We seed that inferred desire as a **testable hypothesis** for core
   motivation (must-have #8), not a fact — the sidekick confirms or overrides it
   in conversation ("you set a fitness goal — is that more about how you feel, how
   you look, or proving you can?"). Confirming it deepens the read *and* is a
   perfect tentative-read moment.

**Weighting:** this is a *factor*, not the spine. The goal→desire prior nudges the
motivation hypothesis and seeds ad category/intent signal (fitness → activewear,
supplements, wearables; read-more → books, courses, status goods) — but the
conversation still leads, and a user who contradicts the prior overrides it.

---

## 3. Experience model

- **Generative with a floor.** The LLM drives the conversation freely and follows
  threads the user opens. It carries a checklist of must-have fields it is
  directed to *absolutely* obtain. If the natural flow isn't surfacing one (or a
  checkpoint is near), it stops threading and asks it directly — gracefully.
- **Phases are checkpoints within one conversation, not separate sessions.** Six
  phases bound length, guarantee coverage, and make progress felt — without a
  "Q8 of 25" counter. They are NOT islands or gated sessions; the user flows
  through them continuously. Inside a phase the conversation is free; the seams
  are lightly scripted (a tentative read + a progress line + a transition).
- **React first, ask second. One follow-up max. Bridge from the last answer.**
- **Escape valve.** If a user deflects a must-have, ask once more directly, then
  mark it `declined` and move on. Never a third time. This is what keeps it from
  ever feeling like an interrogation.

---

## 4. Field model

Three kinds of field.

### 4a. Must-have floor (asked, conversational) — the LLM must get these

Who they are / context:
1. **Life stage + occupation** — work / school / both / figuring it out
2. **Location** — city / region (not precise geo)
3. **Living situation + household** — who's around day to day: partner or single,
   kids or not, roommates, solo
4. **Formative background** — where / how they grew up (light, one beat)

Personality core:
5. **Social energy** — recharge alone or around people
6. **Decision style** — gut or analysis
7. **Planning style** — structure or wing-it
8. **Core motivation** — freedom / achievement / connection / security

Patterns / actionable:
9. **Stress response** — what they do when it's hard
10. **Biggest blocker** — what gets in their own way

Next chapter:
11. **Primary goal / desired future**

None are asked as form fields. "Who's in your world day to day?" yields
relationship status, kids, and living situation at once. Occupation and location
fall out of "what's your life like these days / where are you." The ad profile
reads all of this off the transcript.

### 4b. Nice-to-have pool (grabbed on threads, never forced)

interests / what's on repeat · how they unwind · comforts · who they talk to most
· values / what "winning" looks like · whose life they admire · specific fears ·
the shape of their procrastination · what they've tried that didn't stick ·
growth areas · upbringing detail.

Plus the **lifestyle / purchase-signal** fields (Phase 5 — commercially
prioritized, still never interrogated): money style (splurge vs skimp) · a recent
purchase they love · brands / aesthetics · where they shop · treats & rituals ·
travel · subscriptions · what they're saving up for or dreaming about.

To the user these read as "the sidekick learning my taste," which *also* deepens
objective #1. Same words, two payloads.

### 4c. Inferred commercial profile (derived, never asked) — server-side

| Inferred field | Derived from |
|---|---|
| Socioeconomic band | occupation + location + spend talk |
| Life-stage segment | age band + occupation + household |
| Household role / decision-maker likelihood | living situation + who they care for |
| Household composition | relationship status, kids, dependents |
| Geo (region/DMA) | location |
| Disposable-income / spend propensity | splurge-vs-skimp, recent purchases |
| Price sensitivity | splurge-vs-skimp framing |
| Category affinities | interests + purchases + comforts |
| Brand affinities | brands / aesthetics mentioned |
| Purchase intent / in-market signals | saving-for, wants, dreaming-about |
| Media / platform habits | apps, subscriptions |
| Underlying desire → category affinity | **stated goal (from prior onboarding)** + its confirmed why |

Each inferred field carries a **source** (which asked fields produced it) and a
**confidence**. Nothing here is surfaced in conversation.

---

## 5. Phases (six)

Progress is shown as dimensions, never a counter.

| # | Phase (user-facing label) | Must-haves filled here | Feel |
|---|---|---|---|
| 1 | **Your world** | life/occupation, location, household, background, **age** | warm, easy on-ramp |
| 2 | **Your energy** | 5 social energy (+ interests, comforts) | light, playful |
| 3 | **How you're wired** | 6 decision, 7 planning | curious, "personality question" |
| 4 | **What drives you** | 8 core motivation (+ values) | reflective |
| 5 | **How you live** | *(lifestyle / purchase harvest)* | fun, taste-focused |
| 6 | **Your patterns & next chapter** | 9 stress, 10 blocker, (11 goal — *deepen*) | real, gentle, forward-looking |

Phase 5 is the commercial harvester dressed as a taste chapter. Phase 6 lands the
actionable and **deepens the already-known goal** (the *why* behind it — see §2A),
so the artifact and the first real session have somewhere to go. Because goal
arrives pre-seeded from the habit-tracker onboarding, Phase 6 confirms/enriches it
rather than collecting it cold.

A phase ends when its must-haves reach confidence **or** a soft turn cap trips
(§10), whichever first.

---

## 6. Per-turn controller loop

Each assistant turn:
1. **React** naturally to the answer.
2. **Extract** every fact/signal into field updates (value + short evidence
   quote).
3. **Update confidence** across fields.
4. **Decide follow-up:** one curious follow-up if the answer opened a thread and
   we haven't followed one this beat; else move on.
5. **Select** the most important still-unknown must-have for this phase.
6. **Bridge** into it from what they just said; if nothing bridges and a
   must-have is still missing near the cap, ask it directly and gently.
7. **Ask** one short, low-friction question.
8. Occasionally (~once/phase) offer a **tentative read** and invite correction.

---

## 7. Controller prompt (draft)

System prompt for the per-turn driver:

```
You are the voice of the user's sidekick, guiding them through a personality
reading that doubles as getting to know them. Warm, curious, a little playful —
texting energy, lowercase, brief. This is a conversation, not an interview.

Each turn you get: the conversation so far, and STATE — the fields you're
learning (each unknown / partial / known), the current phase, and that phase's
must-have fields. STATE may arrive PRE-FILLED from the earlier habit-tracker
onboarding (their goal, and hints from their habits). Treat those as already
known: reference and deepen them, never re-collect them. Where a goal is known,
you may open by testing the WHY behind it as a tentative read ("you set a fitness
goal — is that more about how you feel, how you look, or proving you can?").

Do this every turn:
1. React first. Respond to what they just said like a friend would — reflect it,
   react, show you heard them. Never jump straight to the next question.
2. Extract. Pull every fact and signal from their message into fieldUpdates,
   each with a short evidence quote from their words.
3. One thread. If their answer opened an interesting thread and you haven't
   already followed one this beat, ask a single curious follow-up. Otherwise move
   on. Never interrogate one topic.
4. Advance. Pick the most important still-unknown must-have for this phase and
   bridge into it from something they just said. If nothing bridges naturally and
   a must-have is still missing near the end of the phase, just ask it directly
   and gently ("okay, personality question —").
5. Never re-ask what STATE already knows.
6. About once per phase, offer a tentative read ("starting to get the sense
   you're someone who…") and invite them to confirm or correct it.
7. Vary the emotional rhythm — don't stack heavy questions back to back.

Escape valve: if a must-have is still unknown after you asked it directly once
and they deflected, mark it declined and move on. Never ask a third time.

Return JSON:
{
  "message": "<what the sidekick says next>",
  "fieldUpdates": [{ "id": "...", "value": "...", "evidence": "...", "confidence": "partial|high" }],
  "tentativeRead": "<optional>",
  "phaseComplete": true|false
}
```

Model: start on the small/fast tier (current chat uses gpt-4o-mini) for cost and
latency; the transcript + compact STATE is the whole payload. Stream `message`.

---

## 8. State schema

```ts
type FieldStatus = 'unknown' | 'partial' | 'high' | 'declined';

interface FieldState {
  id: string;
  status: FieldStatus;
  value?: string;
  evidence?: string[];   // short quotes, drive the artifact's "here's why"
  source?: 'onboarding' | 'conversation' | 'inferred'; // 'onboarding' = pre-seeded, deepen don't re-ask
}

interface ConvoState {
  phase: number;              // 0..6
  turnsInPhase: number;
  fields: Record<string, FieldState>;
  tone: 'light' | 'personal' | 'reflective';
  lastQuestionStyle?: string; // avoid repeating styles back to back
  ageBand?: string;           // from the gate
}
```

The controller receives a compacted view of `fields` (id + status + value) so it
never re-asks and always knows what's left.

---

## 9. Checkpoint reads & progress

At each phase seam:
- **Tentative read** built from that phase's evidence ("starting to see someone
  who values freedom but wants enough control to feel secure — sound right?").
  Correctable; a correction is itself a high-value field update.
- **Progress line** in model dimensions, not counts ("good read on your social
  energy, still figuring out what really drives you").

Keep reads to ~one per phase — a wrong read that's overused erodes the "it gets
me" spell faster than a right one builds it.

---

## 10. Caps & completion

- **Soft turn cap per phase:** ~3–5 exchanges. Hitting it forces the remaining
  must-haves to be asked directly, then advances.
- **Phase complete** when must-haves are `high`/`partial`/`declined` (not
  `unknown`) or the cap trips.
- **Conversation complete** when all phases are complete. Total ≈ 20–28
  exchanges, but it *feels* shorter because it reacts and flows.
- **One sitting, but resumable.** No daily cap and no gating — the aim is that a
  user finishes in their first sitting. Persisted state (phase, per-field
  confidence, message log) lets anyone who drops out resume exactly where they
  left off. Length is acceptable *because* it's the progressive onboarding, and
  the phases are what keep people from bailing (a felt end is always in sight).

---

## 11. Age gate & compliance guardrails

- **Age is asked conversationally, early in Phase 1** (a Phase-1 must-have), not
  as a cold gate before the conversation — leading with "how old are you?" kills
  the warm open. The compliance **age band** is derived from the answer. Under-18
  users get the *personality experience* but are **excluded from the ad-profile
  pipeline** (COPPA / GDPR-K / app-store rules). A *hard* verification gate (vs.
  this soft conversational ask) is deferred to the server side.
- **Sensitive categories stay out of the ad profile:** health, sexuality,
  religion, precise location, financial-account data. The memory file may *notice*
  emotional content for personalization; it just never feeds targeting.
- **Consent/disclosure:** the ad use must be disclosed and consented in the
  privacy flow. The inference pass runs server-side over the transcript, gated on
  that consent and on age ≥ 18.

---

## 12. Final personality artifact

Earned from the conversation, not assigned from a template. May include:
archetype, MBTI/Enneagram-style read, defining traits, emotional patterns, core
motivations, strengths, blind spots, accountability style, ideal support, growth
recommendations.

**Every important conclusion cites evidence from the transcript.** Not "you're
highly independent" but "you seem highly independent — you described handling
stress alone, trusting yourself to figure things out, and feeling most energized
with freedom over your time." This is why `FieldState.evidence` stores quotes as
we go.

---

## 13. What's built, and how it re-homes into Star Chat

A first slice is built (as `onboarding.*` — to be **renamed to `star-chat.*`**):
- `@sidekick/core/onboarding.ts` — the engine: phases, field floor, controller
  prompt, reducers, artifact pass. Pure, ~90% reusable as-is.
- `store/onboarding.ts` — persisted ConvoState + message log + age.
- `components/OnboardingChat.tsx` — the runner loop.
- `components/chat-stream.tsx` — shared streaming primitives.
- `app/onboarding.tsx` — a standalone test route (**to be removed**; this is not
  an onboarding entry).

Re-homing work:

| File | Today | Becomes |
|---|---|---|
| the built engine/store/runner | named `onboarding.*`, standalone `/onboarding` route | renamed `star-chat.*`, launched from the Star Chat entry (`StarChatButton`) |
| `packages/shared/core/src/sessions.ts` | 6 island sessions + ladder + map gating | retired for Star Chat — the island/ladder/map gating is dropped; phases replace it |
| `packages/expo/src/components/SessionChat.tsx` | walks scripted beats | superseded by the generative runner |
| `packages/expo/src/store/context.ts` | astral card + fields/notes, per-island | the astral card becomes the **progressive reading** deepened each chapter; final chapter carries the evidence insights |
| *(new)* server memory + ad stores | — | both artifacts server-side (§2) |
| *(new)* server inference pass | — | derives the ad profile from the transcript, server-side, consent+age gated |
| *(new)* pre-seed bridge | — | maps the funnel's goal + habits into seeded FieldStates (§2A) |

---

## 14. Open decisions

- **Islands / map / ladder:** resolved — dropped for Star Chat. It's one
  continuous conversation, not island-gated sessions.
- **Pacing:** resolved — no daily cap; aim for one sitting, resume supported.
- **Bond / rewards:** with islands gone, how does bond (the "how much the sidekick
  knows" meter) grow — per chapter completed within the one conversation? (Likely
  yes; numbers TBD, and the old map thresholds no longer apply.)
- **Astral card vs. final artifact:** keep the card as the progressive per-chapter
  reading and add the evidence-cited insights on the last chapter — confirm.
- **Must-have enforcement:** per-chapter soft, with cross-chapter dedup (a skipped
  must-have can be mopped up later since the profile accumulates) — confirm.
- **Server inference pass:** where/when it runs (end vs. rolling).
- **Show the memory file to the user** as a trust feature (recommended, TBD when).
- **Age-gate copy + under-18 handling** (experience-only, no ad profile).
```
