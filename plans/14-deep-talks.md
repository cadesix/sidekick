# 14 — Deep Talks, Context Score & ChatGPT Import

Daimon calls this "imprinting": structured ways to make the sidekick know you faster, gamified so feeding it context feels like progression, not data entry. Ours has three parts: **deep talks** (guided conversation sessions), the **context score** (a visible "how well your sidekick knows you" meter), and **memory import** (bootstrap from ChatGPT's memory of you). All three are accelerants for the same asset — the memory system in [user-memory.md](user-memory.md) — and everything they learn flows through the existing extraction pipeline. No new memory machinery.

## Deep talks (guided sessions)

A deep talk is a 5–10 minute guided conversation on one theme, run **inside the main thread** (it's still just talking to your sidekick — no separate mode UI beyond a banner). The catalog ships as data in `packages/shared/deep-talks.ts`, same pattern as the funnel manifest:

```ts
type DeepTalk = {
  slug: string;            // 'your-people' | 'work-life' | 'taste-check' | 'how-you-tick' |
                           // 'the-backstory' | 'money-mind' | 'dream-big' | ...  (launch with 8)
  title: string;           // "Your people"
  teaser: string;          // "who's in your corner? i wanna know the cast"
  emoji: string;
  targetKinds: MemoryKind[];      // which memory kinds this session is designed to fill
  beats: string[];         // 4-6 prompt beats the model works through, e.g.
                           // "who do they live with / see most days",
                           // "closest friend and the story of how they met", ...
  unlockAtScore: number;   // 0 for the first three; 25/40/55/70 for later ones
};
```

**Runner mechanics:** starting a deep talk inserts a system-side note into the context (`ACTIVE DEEP TALK: {title} — work through these beats naturally, one at a time, reacting like a friend, not an interviewer; drop any beat that doesn't land; wrap up warmly when done or if the user wants out`) plus the beats. The session has no hard turn count — the model calls a new `complete_deep_talk(slug)` tool when the beats are exhausted or the user disengages. Completion triggers: an **immediate extraction pass** (don't wait for the 30-min idle — the payoff must be visible right away), a context-score recompute, and a reward grant (below). Abandoning mid-way (user just stops replying) is fine: the idle extractor still harvests whatever was said, and the talk stays resumable for 48h then quietly expires.

Anti-interrogation rules (the difference between a deep talk and a form): one beat at a time; every user answer gets a real reaction before any next question; if the user redirects the conversation, follow them — the beats are a map, not a script.

## Context score

One number, 0–100, shown as "how well {sidekick} knows you". Computed server-side on every `memory_version` bump, stored on `users.contextScore`:

```
score = round(100 × Σ_k w_k × min(n_k, c_k) / c_k)

kind          w_k   c_k        kind          w_k   c_k
identity      .14    4         interest      .14   10
work_school   .10    3         preference    .12    4
relationship  .16    6         event         .10    6
schedule      .08    3         emotional     .08    3
goal_context  .08    4
```

(`n_k` = active memories of that kind.) Weights favor the kinds that make conversation feel *known* (people, interests, preferences). The formula is deliberately dumb and monotonic — it's a progress bar, not a science; never let it decrease from compaction (folded memories count via their replacement sentence).

**Score UI:** lives at the top of the existing "what my sidekick knows" screen — a SolidShadow card: sidekick face (48px) + `knows you 34%` (Heading 27) + the 06 progress-bar recipe underneath + one in-voice line keyed to the band (0–25 "we're just getting started", 25–50 "getting somewhere", 50–75 "basically besties", 75+ "scary how well i know you"). Below it, the **deep-talk shelf**: horizontal scroll of cards (SolidShadow, 140×120, pastel background via `pastelFor(i)`, emoji 28px + title Option 15/700 + teaser Caption/60, locked ones at 40% opacity with a 16px ink lock and "knows you {n}% to unlock" Caption). Score changes animate the bar (`bar-grow` mapping from 06 §4) with haptic `impactLight`.

**Unlocks (skill unlocking, our version):** score thresholds gate *flavor and content*, never core utility (web search, reminders, docs all work from day one — gating usefulness behind grind is how you lose users). Thresholds grant: new deep-talk topics (the ladder above), one exclusive cosmetic per 25-point band (wired through 04's `rewards` grant path, `source:'event'`), and at 50+ the extra opener archetypes ("callback to something from way back") that only work with deep context. The sidekick announces unlocks in-voice in the thread — never a system modal.

## ChatGPT memory import

Users who've talked to ChatGPT for years have a ready-made profile; importing it collapses weeks of cold start. Two paths, both feeding the standard extraction pipeline with `source:'import'`:

1. **Paste (v1):** an "import from ChatGPT" row on the memory screen opens a sheet with illustrated 3-step instructions — *open ChatGPT → ask it "list everything you remember about me from memory, verbatim" → copy the answer and paste it here* — above a paste `TextInput` (field style, 6 rows) and a PrimaryButton "let {sidekick} read it". Server runs the extractor over the pasted text (existing `apply_memory_ops`, dedup against current memories as always).
2. **Export file (Phase 5):** accept ChatGPT's data-export zip via the 09 file picker; parse `conversations.json`, take the most recent ~50 conversations, and run chunked extraction. Strictly bounded (cap total extraction calls at ~20/import) and queued as a background job with a push when done.

**Review before commit — non-negotiable:** imported ops are staged, not applied. The sheet transitions to a review list — each candidate memory as a row (kind emoji + sentence, Body) with a checkbox (checked by default, 06 check-circle recipe); "add these {n}" PrimaryButton applies only the checked set. Importing wrong facts silently would poison the well on day one. After apply: the score bar animates up and the sidekick sends one in-voice thread message reacting to *one* highlight ("ok wait, you've run a marathon?? we need to talk about this") — the import must immediately prove it worked.

Privacy note carried on the sheet in Caption: imports are memories like any other — visible, editable, deletable on this screen, and never shared with advertisers beyond the existing allowlist projection (user-memory §5 exclusions apply unchanged).

## Effort

- Deep-talk catalog (8 sessions, writing-heavy) + runner + `complete_deep_talk` + immediate extraction: **2d**
- Context score compute + score card + shelf UI + unlock grants via 04: **2d**
- Paste import + staged review UI + reaction message: **1.5d**
- Export-zip import job: **1.5d** (Phase 5)

Ships in **Phase 4** (score + first three talks + paste import), with the talk ladder and zip import trailing. Depends on: user-memory (pipeline), 04 (reward grants), 09 (file picker, for zip import only).
