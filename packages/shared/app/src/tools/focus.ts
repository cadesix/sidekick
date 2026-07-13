import { z } from "zod";
import { focusSetBudgetInput, focusUnblockInput } from "../focus/schema";
import { defineTool, type SidekickTool } from "./types";

/**
 * Focus mode capability (13-focus-mode.md). Every tool is a *device* tool
 * (`execution:'client'`, the pattern from 12): the DeviceActivity/ManagedSettings
 * calls must run on-device, and the user is mid-chat so the app is alive. The app
 * runs the native op, mirrors the app-identity-free state to `focus.update`, and
 * the model continues the turn. If focus isn't available (no entitlement / older
 * iOS), the app returns `{ error: 'device_unavailable' }` and the model says so.
 */
export const focusTools: SidekickTool[] = [
  defineTool({
    name: "focus_open_setup",
    description:
      "Open the focus setup screen so the user can pick which apps to guard and set a daily budget. Use when they want to start focus mode, change which apps are blocked, or edit their budget — the app picker is a native system view you can't drive yourself.",
    execution: "client",
    parameters: z.object({}),
  }),
  defineTool({
    name: "focus_set_budget",
    description:
      "Set or change the user's daily focus budget in minutes (the time they can spend on guarded apps before the shield goes up). Confirm the number back casually. A budget under 15 minutes deserves one light reality-check ('bold. sure?') before you set it.",
    execution: "client",
    parameters: focusSetBudgetInput,
  }),
  defineTool({
    name: "focus_block_now",
    description:
      "Immediately block the guarded apps ('lock me out, i'm studying'). No budget needed. Set the re-see-you in your reply ('locked. crush it — i'll be here').",
    execution: "client",
    parameters: z.object({}),
  }),
  defineTool({
    name: "focus_unblock",
    description:
      "Temporarily unlock the guarded apps for N minutes (5–60; out-of-range is clamped). The apps re-block automatically when the time is up. Grant freely on the first ask of the day; after that get playfully skeptical ('third time today… is the group chat that good?') but never lecture and never flat-out refuse more than once. Follow up in-voice when the re-block lands.",
    execution: "client",
    parameters: focusUnblockInput,
  }),
  defineTool({
    name: "focus_status",
    description:
      "Check how focus is going today — whether it's on, the daily budget, roughly how many apps are guarded, and whether the user has hit their 80% warning or the block yet. Use for 'how am i doing today?' style questions.",
    execution: "client",
    parameters: z.object({}),
  }),
  defineTool({
    name: "focus_disable",
    description:
      "Turn focus mode off completely and remove all blocks. Give one honest in-voice check ('you set this up for a reason — sure?'), then if they confirm, comply immediately and fully. Never hold them hostage.",
    execution: "client",
    parameters: z.object({}),
  }),
];

/**
 * Chat-side steer for the focus tools (13 §chat tools) — the capability's
 * `promptGuidance`, appended to the system prompt whenever focus is enabled.
 */
export const FOCUS_CHAT_GUIDANCE = `Focus mode (app blocking the user set up on themselves):
- You are the face of the shield — friction with personality, never a nag. The apps are the user's own commitment; the OS enforces it, you mediate it.
- You never see which apps they chose or what they browse — only whether focus is on, the budget, and today's warn/block flags. Don't pretend to know more.
- Unlocks (focus_unblock): grant the first request of the day without fuss. After that, be playfully skeptical, but relent — one push-back at most, then comply. Never a bypass button; the negotiation is the point.
- focus_disable: one honest "sure?" then comply fully and immediately. Refusing to let someone turn it off is an uninstall.
- Progress logging stays silent (03) — the home shield chip and streaks reflect it; don't announce tool calls.` as const;
