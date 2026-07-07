# 11 — Web Search & Current Events

The sidekick can look things up: "is the marathon still on sunday?", "find me a beginner lifting program", what's happening in the user's fandoms. We use **Anthropic's server-side `web_search` tool** — no search-provider integration, no scraping infra; the model searches mid-turn and returns cited text. A separate `web_fetch` tool covers "read this link" when the user pastes a URL.

## Integration (exact)

Both tools register through the AI SDK in the chat pipeline (01 step 3):

```ts
import { anthropic } from "@ai-sdk/anthropic";

tools: {
  web_search: anthropic.tools.webSearch_20250305({
    maxUses: 3,
    userLocation: userCity
      ? { type: "approximate", city: userCity, region: userRegion, country: userCountry, timezone: userTimezone }
      : undefined,
  }),
  web_fetch: anthropic.tools.webFetch_20250910({ maxUses: 2 }),
}
```

- Start on the basic `_20250305` search variant. The dynamic-filtering `_20260209` version defaults `allowed_callers` to code-execution and needs `allowed_callers: ["direct"]` — an upgrade to evaluate later, not a v1 dependency.
- `userLocation` comes from the coarse city stored by [12-life-integrations.md](12-life-integrations.md); this is what makes "any good climbing gyms around here?" work. Omit cleanly when unknown.
- `web_fetch` can only fetch URLs already present in the conversation (platform security constraint) — exactly the "user pasted a link" case. No per-fetch charge; token costs only.
- Handle `stop_reason: "pause_turn"` by resending the assistant message unchanged; search errors arrive as `web_search_tool_result_error` blocks inside a 200 — surface nothing to the user, the model recovers in-turn.
- Enable web search at the Claude Console org level (it can be disabled org-wide — a silent 400 if forgotten).

**Interplay with 08 (compaction):** search-result blocks carry `encrypted_content` that must be echoed back **verbatim** while those messages are in the verbatim tail — the derived-view assembler must pass tool-result blocks through untouched. When compaction folds a message out of the tail, its search blocks vanish entirely (replaced by the summary's plain text) — that's valid; what's forbidden is including a mangled block.

## Prompt policy (when to search)

Lines added to the persona prompt: *Search when the answer depends on the current world — news, prices, schedules, places, anything after your knowledge cutoff, or when the user asks you to look something up. Never search during emotional conversations; presence beats facts there. Weave results in like a friend who just checked their phone ("ok so it says…"), don't recite. If a search fails or comes back empty, say you couldn't find it — never fake a result.*

**Current events proactivity** (00's "pop-culture proactivity", now concrete): the daily opener job (03) gets `maxUses: 1` web search and this instruction — *at most twice a week, if one of their interests plausibly had news (game released, team played, artist dropped something), you may check and open with it.* Cap enforced by recording opener-search usage per user per week. This single feature is what makes the sidekick feel alive in the world rather than sealed in the app.

## Cost & guardrails

$10 per 1,000 searches ($0.01 each) + result tokens; billed per search executed, reported in `usage.server_tool_use.web_search_requests` (log it per message like other token counts). Caps: `maxUses: 3` per turn, **20 searches/user/day** server-side — past the cap the tool is simply omitted from the registry for the rest of the day and the model answers from knowledge (degrades invisibly). Expected steady-state is <1 search/user/day; the cap is a runaway guard, not a rationing scheme. Feature-flagged per user (PostHog) like ads.

**Ads separation (05):** organic search results and sponsored cards must never blur. Search citations render in the chrome below (never card-styled); Gravity's SponsoredCard keeps its `Sponsored` label and distinct chrome. A turn may carry both — a search-grounded answer is often purchase-adjacent, which is exactly the high-intent slot 05 prioritizes. What's banned: the model presenting an ad as a search finding or vice versa (structurally impossible since ads never enter model context, 08).

## Citations UI

The AI SDK surfaces citations as source parts during streaming. Under any bubble whose message used search, render a **source row**: up to 4 pills, wrap-enabled, 6px gaps —

- Pill: `border border-ink/15 bg-field rounded-full px-2.5 py-1`, Caption (12/500) `text-ink/60`, content = the source's domain (`nytimes.com`), max-width 140 with middle truncation. A 12px globe glyph (ink/40) leads the first pill only.
- Tap → in-app browser (`expo-web-browser` `openBrowserAsync`, which is `SFSafariViewController` — same surface as ad click-throughs in 05).
- More than 4 sources: fourth pill becomes `+N more`, tap expands the row in place.
- While the model is mid-search during streaming, the typing indicator gains a Caption line beneath: `looking it up…` (fades in/out, 06 fade tokens). No spinners, no "Searching the web 🔍" banners.

Rejected: rendering inline superscript citation markers in the bubble text — right for a research product, wrong for a friend texting you; the source row keeps trust without footnote energy.

## Effort

- Tool registration + pause_turn/error handling + encrypted-content passthrough in 08's assembler: **1d**
- Source-row UI + in-app browser + "looking it up" state: **1d**
- Prompt policy + opener proactivity + per-day caps + usage logging/flag: **1d**

Ships in **Phase 3**. Depends on: 12 for `userLocation` (optional — ships without it), 08's assembler hook.
