import { anthropic } from "@ai-sdk/anthropic";
import type { ToolSet } from "ai";
import { isToolEnabled } from "./registry";
import type { ProviderToolContext, SidekickTool } from "./types";

/**
 * Provider-executed search tool names (11). These are NOT `defineTool` server
 * tools — Anthropic runs them mid-turn and returns cited text — so the capability
 * contributes them through `providerTools` (below), not the `tools` array.
 * `searchTools` stays empty; the names are exported for cap accounting + flags.
 */
export const WEB_SEARCH_TOOL = "web_search";
export const WEB_FETCH_TOOL = "web_fetch";

/** Per-turn caps (11 §cost & guardrails). */
export const WEB_SEARCH_MAX_USES = 3;
export const WEB_FETCH_MAX_USES = 2;

/**
 * In-band control frames the chat text stream writes when a provider search
 * starts/finishes (11 §citations UI). The client strips these and toggles the
 * "looking it up…" caption under the typing indicator — no spinners, no banners.
 * The U+0001 (SOH) delimiters can never appear in model prose, so they split
 * cleanly out of the byte stream on the client.
 */
export const SEARCH_STREAM_START = "looking-up-start";
export const SEARCH_STREAM_END = "looking-up-end";

export const searchTools: SidekickTool[] = [];

/**
 * Persona-prompt policy for web search (11 §prompt policy), added through the
 * capability guidance seam. Static per-day, so it stays inside 08's cacheable
 * prompt region.
 */
export const SEARCH_CHAT_GUIDANCE = `Looking things up:
- Search when the answer depends on the current world — news, prices, schedules, places, sports, anything after your knowledge cutoff, or when they ask you to look something up.
- Never search during emotional conversations. Presence beats facts there — just be with them.
- Weave results in like a friend who just checked their phone ("ok so it says…"), don't recite a report.
- If a search fails or comes back empty, say you couldn't find it. Never fake a result or a source.` as const;

/**
 * Anthropic's approximate `userLocation` for geographically relevant results
 * (11 §integration). Assembled from the user's coarse city (12); omitted cleanly
 * when unknown so the request carries no location at all.
 */
export type UserLocation = {
  type: "approximate";
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
};

/**
 * The provider-executed search tools this capability contributes to a turn.
 *
 * `web_search` is withheld two ways that both degrade invisibly: the per-user
 * feature flag (`web_search`) and the server-side daily cap (`searchWithinDailyCap`
 * — 20/user/day, computed in the chat pipeline). When absent the model just
 * answers from knowledge. `web_fetch` only ever fetches URLs already in the
 * conversation (a platform constraint), so it needs no cap.
 *
 * NOTE: web search must also be enabled at the Anthropic Console org level, or
 * every request 400s silently — there is no per-request opt-in for that.
 */
export function buildSearchProviderTools(ctx: ProviderToolContext): ToolSet {
  const set: ToolSet = {};
  if (isToolEnabled(WEB_SEARCH_TOOL, ctx.flags) && ctx.searchWithinDailyCap) {
    set[WEB_SEARCH_TOOL] = anthropic.tools.webSearch_20250305({
      maxUses: WEB_SEARCH_MAX_USES,
      userLocation: ctx.userLocation,
    });
  }
  if (isToolEnabled(WEB_FETCH_TOOL, ctx.flags)) {
    set[WEB_FETCH_TOOL] = anthropic.tools.webFetch_20250910({ maxUses: WEB_FETCH_MAX_USES });
  }
  return set;
}
