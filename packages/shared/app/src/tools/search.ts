import { openai } from "@ai-sdk/openai";
import type { ToolSet } from "ai";
import { isToolEnabled } from "./registry";
import type { ProviderToolContext, SidekickTool } from "./types";

/**
 * Provider-executed search tool name (11). This is NOT a `defineTool` server
 * tool — OpenAI runs `web_search` mid-turn (Responses API) and returns cited
 * text — so the capability contributes it through `providerTools` (below), not
 * the `tools` array. `searchTools` stays empty; the name is exported for cap
 * accounting + flags. OpenAI's web search subsumes page fetching (its openPage /
 * findInPage actions), so there is no separate `web_fetch` provider tool.
 */
export const WEB_SEARCH_TOOL = "web_search";

/**
 * How much context OpenAI pulls per search (11 §cost & guardrails). `medium`
 * balances answer quality against latency/cost; `stepCountIs` in the turn loop
 * bounds how many searches a single turn can run.
 */
export const WEB_SEARCH_CONTEXT_SIZE = "medium" as const;

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
 * The approximate `userLocation` for geographically relevant results (11
 * §integration). Assembled from the user's coarse city (12); omitted cleanly
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
 * The provider-executed search tool this capability contributes to a turn.
 *
 * `web_search` is withheld two ways that both degrade invisibly: the per-user
 * feature flag (`web_search`) and the server-side daily cap (`searchWithinDailyCap`
 * — 20/user/day, computed in the chat pipeline). When absent the model just
 * answers from knowledge.
 */
export function buildSearchProviderTools(ctx: ProviderToolContext): ToolSet {
  const set: ToolSet = {};
  if (isToolEnabled(WEB_SEARCH_TOOL, ctx.flags) && ctx.searchWithinDailyCap) {
    set[WEB_SEARCH_TOOL] = openai.tools.webSearch({
      searchContextSize: WEB_SEARCH_CONTEXT_SIZE,
      userLocation: ctx.userLocation,
    });
  }
  return set;
}
