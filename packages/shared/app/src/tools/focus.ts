import { z } from "zod";
import {
  focusSetBudgetInput,
  focusStartSessionInput,
  focusUnblockInput,
} from "../focus/schema";
import { defineTool, type SidekickTool } from "./types";

/**
 * Focus mode capability (13-focus-mode.md). Every tool is a *device* tool
 * (`execution:'client'`, the pattern from 12): the DeviceActivity/ManagedSettings
 * calls must run on-device, and the user is mid-chat so the app is alive. The app
 * runs the native operation and returns only whether that requested command
 * succeeded. If focus isn't available (no entitlement / older
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
    name: "focus_start_session",
    description:
      "Start a timed Focus session for 5–180 minutes after the user explicitly asks. The device blocks the user's private selection and releases it automatically; you only receive command success.",
    execution: "client",
    parameters: focusStartSessionInput,
  }),
  defineTool({
    name: "focus_unblock",
    description:
      "Temporarily unlock the guarded apps for N minutes (5–60; out-of-range is clamped). The apps re-block automatically when the time is up. Grant freely on the first ask of the day; after that get playfully skeptical ('third time today… is the group chat that good?') but never lecture and never flat-out refuse more than once. Follow up in-voice when the re-block lands.",
    execution: "client",
    parameters: focusUnblockInput,
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
- You never see which apps they chose, how much they use them, whether a threshold fired, or whether a shield is currently visible. Never imply otherwise.
- You may change a limit, block, start a timed session, temporarily unlock, disable, or open setup only after the user asks.
- Unlocks and disabling are immediate user controls. Do not bargain, shame, or refuse.
- A successful result confirms only that requested device command; it is not Screen Time status or usage data.` as const;
