import { ATTACHMENT_CHAT_GUIDANCE, attachmentsTools } from "./attachments";
import { checkinsTools } from "./checkins";
import { DEEP_TALK_CHAT_GUIDANCE, deepTalksTools } from "./deep-talks";
import { documentsTools } from "./documents";
import { FOCUS_CHAT_GUIDANCE, focusTools } from "./focus";
import { HEALTH_CHAT_GUIDANCE, healthTools } from "./health";
import { memoryTools } from "./memory";
import { musicTools } from "./music";
import { remindersTools } from "./reminders";
import { SEARCH_CHAT_GUIDANCE, buildSearchProviderTools, searchTools } from "./search";
import { CHECKIN_CHAT_GUIDANCE } from "../prompts/checkin-guidance";
import { REMINDER_CHAT_GUIDANCE } from "../reminders/prompt";
import type { Capability, SidekickTool } from "./types";

export * from "./types";
export * from "./registry";
export * from "./search";
export { onboardingTools } from "./onboarding";

/**
 * Every capability: its tools plus the optional chat-side guidance that travels
 * with them. `buildContextView` appends each enabled capability's guidance to the
 * system prompt (registry order). Feature engineers add a capability here — tools
 * and, if the model needs steering to use them well, a static `promptGuidance`.
 */
export const capabilities: Capability[] = [
  { name: "checkins", tools: checkinsTools, promptGuidance: CHECKIN_CHAT_GUIDANCE },
  { name: "memory", tools: memoryTools },
  { name: "reminders", tools: remindersTools, promptGuidance: REMINDER_CHAT_GUIDANCE },
  { name: "attachments", tools: attachmentsTools, promptGuidance: ATTACHMENT_CHAT_GUIDANCE },
  { name: "documents", tools: documentsTools },
  {
    name: "search",
    tools: searchTools,
    promptGuidance: SEARCH_CHAT_GUIDANCE,
    providerTools: buildSearchProviderTools,
  },
  { name: "health", tools: healthTools, promptGuidance: HEALTH_CHAT_GUIDANCE },
  { name: "music", tools: musicTools },
  { name: "focus", tools: focusTools, promptGuidance: FOCUS_CHAT_GUIDANCE },
  { name: "deep-talks", tools: deepTalksTools, promptGuidance: DEEP_TALK_CHAT_GUIDANCE },
];

/**
 * Every capability's tools, assembled once. Feature engineers only edit the
 * `capabilities` list above; this flattening picks the change up automatically.
 */
export const allTools: SidekickTool[] = capabilities.flatMap((c) => c.tools);
