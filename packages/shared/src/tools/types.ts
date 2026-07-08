import type { ToolSet } from "ai";
import type { z } from "zod";
import type { Database } from "@sidekick/db";

/**
 * Where a tool's side effect runs.
 * - `server`: executed in the chat pipeline against Postgres, result loops back
 *   to the model within the same turn.
 * - `client`: a device-tool (12-life-integrations.md) — streamed to the app,
 *   run natively there, result returns via `chat.deviceToolResult`.
 */
export type ToolExecution = "server" | "client";

/** Everything a server tool needs to do its work. Injected per chat turn. */
export type ToolContext = {
  db: Database;
  userId: string;
  conversationId: string;
};

/**
 * A registered capability. Feature engineers create these with `defineTool` in
 * their own file under `packages/shared/src/tools/` — no other file changes.
 * The stored `execute` takes `unknown` and validates with `parameters` before
 * running, so both model- and device-supplied arguments are checked.
 */
export type SidekickTool = {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  execution: ToolExecution;
  execute?: (input: unknown, ctx: ToolContext) => Promise<unknown>;
};

/**
 * Everything a capability's provider-executed tools need to decide what to
 * contribute this turn (11). Kept free of the `FeatureFlags` alias so `types.ts`
 * stays a leaf; the shape is identical.
 */
export type ProviderToolContext = {
  /** Per-user feature flags — a tool name mapped to `false` is withheld. */
  flags: Record<string, boolean>;
  /** Anthropic's approximate user location, omitted entirely when unknown. */
  userLocation?: {
    type: "approximate";
    city?: string;
    region?: string;
    country?: string;
    timezone?: string;
  };
  /** False once the user is past their server-side daily search cap. */
  searchWithinDailyCap: boolean;
};

/**
 * A capability groups a feature's tools with an optional block of system-prompt
 * guidance. The guidance is appended to the system prompt (after the persona,
 * inside the static/cacheable region — see `buildContextView`) whenever any of
 * the capability's tools is enabled for the user. This is the single seam every
 * feature hangs its chat-side steer on: check-ins, reminders, attachments today;
 * search/health/music/focus/deep-talks later. Keep `promptGuidance` static
 * per-day — no clock time, no volatile content — or it breaks 08's prompt cache.
 *
 * `providerTools` is the seam for Anthropic-executed tools (11's web_search /
 * web_fetch): tools the model runs provider-side rather than `defineTool` server
 * tools. It's a per-turn factory because those tools depend on live context
 * (user location, the daily cap). Assembled by `selectProviderTools`.
 */
export type Capability = {
  name: string;
  tools: SidekickTool[];
  promptGuidance?: string;
  providerTools?: (ctx: ProviderToolContext) => ToolSet;
};

/**
 * Author a tool with input types inferred from its zod schema. The returned
 * tool's execute revalidates input at the boundary.
 *
 * @example
 * export const remindersTools = [
 *   defineTool({
 *     name: "delete_reminder",
 *     description: "...",
 *     execution: "server",
 *     parameters: z.object({ reminder_id: z.string() }),
 *     execute: async ({ reminder_id }, { db, userId }) => { ... },
 *   }),
 * ];
 */
export function defineTool<Schema extends z.ZodTypeAny, Output>(spec: {
  name: string;
  description: string;
  parameters: Schema;
  execution: ToolExecution;
  execute?: (input: z.infer<Schema>, ctx: ToolContext) => Promise<Output>;
}): SidekickTool {
  const run = spec.execute;
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    execution: spec.execution,
    execute: run ? (input, ctx) => run(spec.parameters.parse(input), ctx) : undefined,
  };
}
