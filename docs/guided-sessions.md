# Guided Sessions — UX + Content Design

The map is a progression system over ONE underlying loop: guided chats that
build context about the user. Bond is the score of how much the sidekick knows.
The context powers (1) personalized conversation + advice with real memory, and
(2) ad relevance. Both depend on the same thing: the user *willingly* telling
us true things — so the design optimizes for the user WANTING to share, seeing
the payoff immediately, and staying in control of what's known.

**The loop, one sentence: every island is locked behind ONE guided session;
complete the session, unlock the island, bond goes up.**

---

## 1. Session UX

### Access: one island, one session, one unlock

- Tap a locked island → its modal says plainly: *complete this session to
  unlock it* — session title, ~time, bond reward — with one CTA: **Start
  session**.
- Islands unlock in ladder order (§2): an island's session is only startable
  once the previous island is unlocked, so depth is earned sequentially.
- Bond is the running score of everything learned (the overhead badge); each
  completed session raises it. Unlocks come from completion, not thresholds.

### Where sessions live: their own window, dive in and out

A session runs in its **own chat window** — same bubbles, same voice, same
sliver-of-character layout as the main chat, so it feels like the same friend
in a different moment, not a different app. Sessions are bounded activities
(Duolingo-lesson shaped): enter through the island card, run the arc, exit
through the reward moment.

**Leaving mid-session is fine and expected.** The session stays in progress,
and the main chat gets a specific re-entry point: a compact **continue card**
pinned above the input — island name, progress ("3 of 6"), one tap to dive
back in exactly where it left off. You dive in and out; the session never
mixes into the main thread's scroll.

- Nothing is auto-posted into the main chat — no recap message. The knowledge
  surfaces the right way: the sidekick just *knows* things afterward and
  references them naturally in conversation (the callback moment, §reward).
- One session in progress at a time (the ladder implies this anyway).
- A session left untouched for ~7 days quietly resets to its intro (context
  is stale; re-asking beats resuming a cold thread).

### The format: guided free-form conversation

Every session is **all free-form text input** — no quick-reply chips. The
sidekick guides; the user types. A session is 6–8 question beats, 3–5 minutes,
one island's theme.

- **The script owns the arc, not the answers.** Each beat is a scripted ask
  (with the scene-setting/reasoning style from onboarding), the user answers
  in their own words, the LLM acknowledges *specifically* (referencing what
  they said, in voice) and may probe **once** before moving on. Bounded
  improv: scripted spine, live musculature.
- **Questions must be one-line answerable.** "morning person or night owl?"
  works as free text; "describe your relationship with productivity" doesn't.
  Every ask is written so a lazy 5-word answer is fully valid — the probe
  invites depth, never demands it.
- **Skipping is always available**: a persistent, low-key "skip" affordance
  next to the input. Skips are recorded (a skip on a sensitive topic is
  itself signal to back off).
- **Reactions carry the feel.** With no chips pacing the rhythm, the
  sidekick's specific acknowledgments ("wait, 5am gym? respect. terrifying,
  but respect") are what make it a conversation instead of a form —
  LLM-generated with session context, in the global voice.

### Structured data comes from extraction, not input

Free text everywhere means structured fields are produced by an **extraction
pass**: after each session, an LLM call maps the transcript onto the session's
field schema:

```
transcript + schema → { fields: {chronotype: "night-owl", …},
                        notes: [{tag, quote}], confidence per field }
```

- Server-side (same `/api/*` pattern as chat); the session engine posts the
  transcript with the session's schema.
- Low-confidence fields surface in the recap for confirmation, so the user is
  the validator of last resort — extraction never silently writes facts the
  user didn't mean.

### The recap — the close of every session

The session's final beat: the sidekick reads back what he learned, compressed,
in his voice:

> "ok so: CS junior, night owl pretending to be a morning person, gym tuesdays,
> wants out of ohio by 25. got it. locked in 🔒"

Then **"did i get that right?"** — answered in free text too; corrections
re-run extraction on the reply. Then the reward beat: bond animates up on the
overhead badge, the island unlocks with its celebration, and the travel offer
("wanna go see it?"). The recap is simultaneously the memory-forming proof
moment, the extraction validation UI, and the trust builder for everything
downstream (ads included).

### Secondary entry points

- **Proactive offer** in ambient chat (max once/day, dismissible without
  guilt): "yo can i ask you stuff for like 3 min? i wanna actually know you"
  → deep-links into the next locked island's session.
- **Bond badge tap** → the "What I know about you" surface, with the next
  session as the card on top — the score itself answers "how do I raise this?"

### Memory the user can see and edit

**"What I know about you"** (Bond badge tap): all collected context as cards
grouped by island theme — extracted fields AND their source quotes — each
editable and deletable. Deleting reduces bond accordingly: knowledge IS the
score, so it stays honest. Ad-relevance transparency lives here too (§5).

### Reward loop

- Bond +4–8% per session (deeper islands pay more), animated at recap.
- The island unlock + travel is the celebration.
- Coin bonus per completed session (feeds the shop economy).
- **The real reward is downstream**: the ambient chat visibly using what it
  learned within the next day ("how'd the tuesday lift go?"). Schedule at
  least one callback reference after every session — this is the moment users
  decide the product is magic.
- Sessions are **re-visitable** later as "life update?" versions with deltas
  ("still at the same job?") — context decays; freshness matters for both
  personalization and ads.

---

## 2. Content: one session per island

Six islands, six sessions, ordered by CONVERSATIONAL VALUE — collect the
context that makes every future chat richer first (who you are, what you're
into, where you're from), then wiring, goals, and the deep stuff. Order:
About You → Taste Check → Where You're From → How You're Wired → Goals &
Dreams → The Deep Stuff. On the map, locked islands show a topic card (title +
one-line tease + time/reward) that taps straight into the session; islands
later in the sequence sit dimmed with their order number.

### Frostpeak · "About You" — available day 1

*(covers the starting-point "About you": school/job + daily life)*
- "morning person or night owl? be honest"
- "what's your weekday situation — school, work, both, figuring it out?"
- "so what do you do? and like, what do you actually DO day to day"
- "where do you live — big city, suburbs, small town?"
- "who's at home — roommates, family, partner, just you?"
- "walk me through a random tuesday, speedrun version"
- Extract: `chronotype`, `occupation_type`, `occupation`, `field`,
  `locale_type`, `household` + `weekday_note`

### Pinewood · "Taste Check" — unlocked by its session

*(people + tastes: high ad relevance, low intimacy)*
- "who do you actually talk to most?"
- "does being around people fill you up or drain you?"
- "seeing anyone / married / gloriously single? (skip if you want)"
- "what's on repeat right now — music, shows, games, whatever"
- "how do you actually unwind, honest version"
- "any app you open way too much?"
- Extract: `closest_tie`, `social_energy`, `relationship`, `media_note`,
  `unwind`, `screen_apps` + `people_note`

### Blossom Vale · "Where You're From"

*(the starting-point "Your past")*
- "where'd you grow up?"
- "what kind of place was it?"
- "and what kind of house — loud, quiet, strict, chill?"
- "what's one thing from back home that still shapes you?"
- "anything you're deliberately doing DIFFERENT from how you grew up?"
- Extract: `hometown`, `origin_type`, `upbringing` + `roots_note`
- NOTE: heavy answers get a soft acknowledgment and NO probe — never dig
  twice here. A skip is respected instantly. This session earns
  disproportionate trust when handled well.

### Sandy Dunes · "How You're Wired"

*(personality + drives)*
- Import the funnel's Big Five if present; VALIDATE instead of re-test: "the
  quiz said you're big on openness — feel right or nah?"
- "planner or wing-it person?"
- "when you're stressed, what do you actually do? shut down, speed up, snap, doomscroll?"
- "what do people usually get wrong about you?"
- "what actually drives you — winning, freedom, people, security, peace?"
- "describe a genuinely great day. not a vacation day, a normal great day"
- Extract: `personality` (confidence-weighted), `planning_style`,
  `stress_response`, `core_drives` + `self_note`, `great_day_note`

### Palm Cove · "Goals & Dreams"

*(the starting-point goals/dreams — plus money, the highest direct ad value,
placed deep where it reads as friendship, every beat skippable)*
- "one year from now — what's different?"
- "ok now the 5-year version. no realism allowed"
- "what skill do you wish you just… had?"
- "are you a spender, a saver, or chaos?"
- "saving for anything big right now?"
- "what would you do if money wasn't a thing?"
- Extract: `goal_1yr_note`, `dream_note`, `skill_wants`, `money_style`,
  `saving_targets`, `calling_note`

### Mount Ember · "The Deep Stuff"

*(fears + blockers + history: free-text heavy, personalization-only, the
"it actually knows me" data)*
- "real talk: what gets in your way the most?"
- "when you procrastinate, what does it actually look like?"
- "what's the pattern you keep repeating?"
- "what have you tried before that didn't stick? what almost worked?"
- "what's a fear that drives more of your decisions than you'd like?"
- Extract: `blocker_notes`, `history_notes`, `fear_note`
- Advice that references failed-attempt patterns ("last time you went
  5×/week and burned out — start with 2") is the payoff of this entire system.

*(Body & habits — exercise history, sleep quality, phone hours — fold into
the "life update" re-visits or a 7th island later; they were cut in the
one-session-per-island consolidation.)*

---

## 3. Data model

```
sidekick_context_v1 = {
  fields: { chronotype: "night-owl", occupation: "cs-student", ... },   // extracted
  notes:  [{ tag: "dream", text: "...their words...", session: "palmcove", ts }],
  sessions: { frostpeak: { state: "done" | { beat: 3 }, completedAt?, version }, ... },
}
```

- **fields** = extraction output, enum-ish, queryable → targeting, prompt
  facts. Carry confidence; low-confidence goes through recap confirmation.
- **notes** = verbatim quotes with tags → injected selectively into the system
  prompt; quoting the user's own phrasing back is the personalization cheat code.
- **sessions** = per-island completion/progress state — this is what the map
  reads for locks AND what the main chat's continue card reads.
- Prompt assembly: compact profile block (fields) + 3–5 most relevant notes
  (recency + topic match) appended to the global system prompt, server-side,
  same place `[sidekick.name]` substitutes.
- Every beat emits analytics (`step_completed` with session/beat ids) through
  the existing facade. Skips and mid-session exits are events too — exits are
  the drop-off funnel inside each session.

## 4. Session engine (implementation shape)

One declarative format drives all six sessions (and future ones without code):

```
{ id: "pinewood", title: "Your World", minutes: 3, bond: 6,
  beats: [
    { id: "closest", ask: ["who do you actually talk to most?"], probe: true },
    { id: "battery", ask: ["does being around people fill you up or drain you?"], probe: false },
  ],
  schema: { fields: ["closest_tie", "social_energy"], notes: ["people_note"] } }
```

Runtime per beat: scripted ask → free-text answer → LLM acknowledgment
(+ optional single probe) → next beat, with progress persisted after every
beat (dive in and out). Post-session: extraction call with `schema`, recap
beat with confirmation, then rewards. The onboarding chat retrofits as
session zero of this engine (its goal-picking becomes free text + extraction).

## 5. Trust & ads (product-critical, not legal boilerplate)

The whole model only works while sharing feels safe. Three design rules:

1. **Visible memory** ("What I know about you", editable/deletable, quotes
   shown next to extracted facts) — control is what makes depth feel safe.
2. **Say why, in character, when asked or when it's sensitive**: "i ask so my
   advice isn't generic. also, real talk, ads keep me free — i'd rather show
   you stuff you'd actually want than random junk." Honesty in the sidekick's
   voice converts the ad model from a betrayal risk into a stated deal.
3. **Sensitive lanes stay out of targeting**: upbringing, fears, mental-health
   adjacent notes are personalization-only, never ad signals. Draw this line
   in code (a `targetable: false` flag on fields/notes), not in policy docs.
   Blossom Vale / Mount Ember answers are the trust core of the product;
   monetizing them directly is how you lose the user and the story.

## 6. Open questions

- Extraction timing: per-beat (incremental, enables smarter probes) vs
  end-of-session (one call, simpler)? Start end-of-session.
- Stale-session reset window (7 days is a guess)
- "Life update" re-visit cadence (30-day freshness prompts?)
- Voice sessions later? (free-text format ports cleanly)
- Where body & habits content returns (7th island vs re-visits)
