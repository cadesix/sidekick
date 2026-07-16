import { tool, type ToolSet } from "ai";
import type { Capability, ProviderToolContext, SidekickTool, ToolContext } from "./types";

/**
 * Per-user feature flags. Any tool name mapped to `false` is withheld from that
 * user's turn; absent or `true` means enabled. Backed by env or DB — see
 * `featureFlagsFromEnv`.
 */
export type FeatureFlags = Record<string, boolean>;

export function isToolEnabled(name: string, flags: FeatureFlags): boolean {
  return flags[name] !== false;
}

export function selectTools(tools: SidekickTool[], flags: FeatureFlags): SidekickTool[] {
  return tools.filter((t) => isToolEnabled(t.name, flags));
}

/**
 * The system-prompt guidance blocks for the capabilities a user actually has,
 * in registry order (stable per-day → cache-safe). A capability contributes its
 * guidance when at least one of its tools is enabled; disabling a capability's
 * tools (via feature flags) drops its guidance too.
 */
export function selectGuidance(capabilities: Capability[], flags: FeatureFlags): string[] {
  const blocks: string[] = [];
  for (const capability of capabilities) {
    if (
      capability.promptGuidance &&
      capability.tools.some((t) => isToolEnabled(t.name, flags))
    ) {
      blocks.push(capability.promptGuidance);
    }
  }
  return blocks;
}

/** Reads a comma-separated `SIDEKICK_DISABLED_TOOLS` env var into flags. */
export function featureFlagsFromEnv(env: Record<string, string | undefined>): FeatureFlags {
  const disabled = (env.SIDEKICK_DISABLED_TOOLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return Object.fromEntries(disabled.map((name) => [name, false]));
}

/**
 * Convert registry tools into an AI SDK `ToolSet` bound to a turn's context.
 * Server tools carry an `execute` that runs against Postgres and loops the
 * result back to the model. Client (device) tools are passed WITHOUT execute,
 * so the model emits a tool-call the app fulfils via `chat.deviceToolResult`.
 */
export function toModelTools(tools: SidekickTool[], ctx: ToolContext): ToolSet {
  const set: ToolSet = {};
  for (const t of tools) {
    const run = t.execute;
    set[t.name] =
      t.execution === "server" && run
        ? tool({
            description: t.description,
            inputSchema: t.parameters,
            execute: (input) => run(input, ctx),
          })
        : tool({ description: t.description, inputSchema: t.parameters });
  }
  return set;
}

/** The device-tools in a set — the ones the app must run and report back. */
export function clientTools(tools: SidekickTool[]): SidekickTool[] {
  return tools.filter((t) => t.execution === "client");
}

/**
 * The provider-executed tools (11) every enabled capability contributes this
 * turn, merged into one `ToolSet` for `streamText`. Each capability's
 * `providerTools` factory decides what to include from the live context (flags,
 * user location, daily cap), so a capability past its cap simply returns fewer.
 */
export function selectProviderTools(
  capabilities: Capability[],
  ctx: ProviderToolContext,
): ToolSet {
  let set: ToolSet = {};
  for (const capability of capabilities) {
    if (capability.providerTools) {
      set = { ...set, ...capability.providerTools(ctx) };
    }
  }
  return set;
}

/**
 * Directly run one registry tool. Server tools execute here; client tools have
 * no server-side execution and return a pending marker — their real result
 * arrives through `chat.deviceToolResult`.
 */
export async function dispatchTool(
  tool: SidekickTool,
  input: unknown,
  ctx: ToolContext,
): Promise<{ status: "done"; result: unknown } | { status: "pending_device" }> {
  const run = tool.execute;
  if (tool.execution === "client" || !run) {
    return { status: "pending_device" };
  }
  return { status: "done", result: await run(input, ctx) };
}
