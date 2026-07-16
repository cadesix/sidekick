import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import {
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  generateText,
  stepCountIs,
  streamText,
} from "ai";
import {
  type Database,
  attachments,
  conversations,
  messages,
  proactiveTurns,
  users,
} from "@sidekick/db";
import { modelName } from "../model";
import type { Storage } from "../storage";
import { markMessagesSensitive } from "../memory/ad-window";
import {
  type DeviceToolResultInput,
  type FeatureFlags,
  type UserLocation,
  SEARCH_STREAM_END,
  SEARCH_STREAM_START,
  TAIL_MAX_TOKENS,
  WEB_SEARCH_TOOL,
  allTools,
  attachmentExpansionTokens,
  beatChipHints,
  buildContextView,
  capabilities,
  clientTools,
  encodeDeviceToolCalls,
  encodeStreamMeta,
  estimateTokens,
  isToolEnabled,
  localDate,
  onboardingChatState,
  onboardingTools,
  parseSuggestedReplies,
  renderSuggestedRepliesPrompt,
  renderSystem,
  selectProviderTools,
  selectTools,
  tailTokens,
  toModelTools,
} from "@sidekick/shared";

/**
 * Health-capability tool names (12). A reply produced with any of these is
 * health-derived and must be flagged `sensitive` so the ad-window projection
 * strips it (the ad-window stripping itself is already in place).
 */
const HEALTH_TOOL_NAMES = new Set(
  capabilities.find((c) => c.name === "health")?.tools.map((t) => t.name) ?? [],
);

const HEALTH_CONTEXT_MARKER = "connected Apple Health summary:";
const HEALTH_TEXT_PATTERN = /\b(health|sleep|steps?|workout|exercise|active energy|calories)\b/i;

/** Provider-executed tool names (11) — persisted as `tool` rows so their result blocks round-trip. */
const PROVIDER_TOOL_NAMES = new Set([WEB_SEARCH_TOOL]);

/**
 * Server-side runaway guard (11 §cost & guardrails): 20 searches/user/day. Past
 * the cap the tool is omitted from the registry for the rest of the local day and
 * the model answers from knowledge — the user sees nothing.
 */
const DAILY_SEARCH_CAP = 20;

/**
 * Bound the pause_turn resend loop (11 §integration). A real turn pauses at most
 * once or twice while a long search runs; this is a safety ceiling, not a tuning
 * knob, matching `stepCountIs(8)` inside each attempt.
 */
const MAX_TURN_ATTEMPTS = 5;

export type TurnServices = {
  db: Database;
  model: LanguageModel;
  flags: FeatureFlags;
  userId: string;
  storage: Storage;
  /** Cheap model for the post-hoc suggested-replies call; falls back to `model`. */
  replyModel?: LanguageModel;
};

/** Poll interval / ceiling for the send-time wait on attachment ingest (09). */
const READY_POLL_MS = 200;
const READY_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A device-tool the model invoked; the app runs it and reports back. */
export type DeviceToolCall = { toolCallId: string; toolName: string; input: unknown };

type MessageRow = typeof messages.$inferSelect;
export type TurnOutcome = {
  message: MessageRow;
  deviceToolCalls: DeviceToolCall[];
  finishReason: string;
  /** 0–3 tappable reply chips for this turn (07 §2, flag `suggested_replies`). */
  suggestedReplies: string[];
  /**
   * Safety valve (08 §triggers): the tail exceeded `TAIL_MAX_TOKENS` after this
   * reply, so the caller should schedule an idle job (extraction → compaction)
   * out of band. Never compacted synchronously in the request path.
   */
  needsCompaction: boolean;
};

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Link a message's attachments and block until every one is `ready` (09 §ingest:
 * "the chat turn waits on status='ready'" — the model must see the content on the
 * turn it was sent). A `failed` attachment aborts the turn: no LLM call happens
 * for that message until it's resolved or removed. Ingest normally beats the send
 * tap, so this usually returns on the first poll.
 */
async function attachAndWaitForReady(
  db: Database,
  userId: string,
  messageId: number,
  attachmentIds: string[],
): Promise<void> {
  await db
    .update(attachments)
    .set({ messageId })
    .where(
      and(
        inArray(attachments.id, attachmentIds),
        eq(attachments.userId, userId),
        isNull(attachments.messageId),
      ),
    );

  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const rows = await db
      .select({ id: attachments.id, status: attachments.status })
      .from(attachments)
      .where(inArray(attachments.id, attachmentIds));
    const failed = rows.find((r) => r.status === "failed");
    if (failed) {
      throw new TRPCError({
        code: "UNPROCESSABLE_CONTENT",
        message: "an attachment failed to process",
      });
    }
    if (rows.length === attachmentIds.length && rows.every((r) => r.status === "ready")) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new TRPCError({ code: "TIMEOUT", message: "attachment still processing" });
    }
    await sleep(READY_POLL_MS);
  }
}

export async function ensureMainConversation(
  db: Database,
  userId: string,
): Promise<{ id: string }> {
  const existing = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.userId, userId), eq(conversations.kind, "main")))
    .limit(1);
  const found = existing[0];
  if (found) {
    return found;
  }
  const inserted = await db
    .insert(conversations)
    .values({ userId, kind: "main" })
    .returning({ id: conversations.id });
  const row = inserted[0];
  if (!row) {
    throw new Error("failed to create conversation");
  }
  return row;
}

export async function assertConversationOwned(
  db: Database,
  conversationId: string,
  userId: string,
): Promise<{ kind: string }> {
  const rows = await db
    .select({ userId: conversations.userId, kind: conversations.kind })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const row = rows[0];
  if (!row || row.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "conversation not found" });
  }
  return { kind: row.kind };
}

/** Flag gating the post-hoc suggested-replies call (default on, per flags semantics). */
const SUGGESTED_REPLIES_FLAG = "suggested_replies";

/**
 * Whether this turn should offer reply chips at all: static/no options for
 * tool-heavy or sensitive turns — a turn that ran device tools, provider tools
 * (search), health tools, more than a couple of server tools, or didn't finish
 * cleanly gets none.
 */
function repliesEligible(acc: {
  fullText: string;
  calls: PersistedCall[];
  providerResults: ProviderResult[];
  deviceToolCalls: DeviceToolCall[];
  finishReason: string;
}): boolean {
  return (
    acc.finishReason === "stop" &&
    acc.fullText.trim().length > 0 &&
    acc.deviceToolCalls.length === 0 &&
    acc.providerResults.length === 0 &&
    acc.calls.length <= 2 &&
    !acc.calls.some((call) => HEALTH_TOOL_NAMES.has(call.toolName))
  );
}

/**
 * The cheap post-hoc reply-chips call. Best-effort by design: any model or
 * parse failure yields no chips, never a failed turn.
 */
async function suggestReplies(
  model: LanguageModel,
  input: { userText: string; assistantText: string; optionHints: string[] },
): Promise<string[]> {
  try {
    const { text } = await generateText({
      model,
      prompt: renderSuggestedRepliesPrompt(input),
    });
    return parseSuggestedReplies(text);
  } catch {
    return [];
  }
}

/** The approximate location for a user, or undefined when we know none (11/12). */
export function userLocationFrom(user: {
  lastCity: string | null;
  lastRegion: string | null;
  lastCountry: string | null;
  timezone: string;
}): UserLocation | undefined {
  if (!user.lastCity && !user.lastRegion && !user.lastCountry) {
    return undefined;
  }
  /**
   * `lastCountry` is the localized country *name* from the client's reverse
   * geocode ("United States"), but OpenAI web search requires an ISO 3166-1
   * alpha-2 code ("US") and 400s on anything else. We don't store the code, so
   * only forward `country` when it already is one; otherwise omit it and let
   * city/region/timezone carry the location.
   */
  const country =
    user.lastCountry && /^[a-z]{2}$/i.test(user.lastCountry.trim())
      ? user.lastCountry.trim().toUpperCase()
      : undefined;
  return {
    type: "approximate",
    ...(user.lastCity ? { city: user.lastCity } : {}),
    ...(user.lastRegion ? { region: user.lastRegion } : {}),
    ...(country ? { country } : {}),
    timezone: user.timezone,
  };
}

/**
 * The compact `{ domain-bearing url, title }` sources for a `web_search` result —
 * the citation pills read these (11). OpenAI returns `{ action, sources: [{ type:
 * 'url', url }] }` (url only, no title); older/other shapes that hand back a bare
 * array of `{ url, title }` are still parsed for resilience.
 */
export function webSearchSources(output: unknown): { url: string; title: string | null }[] {
  const raw =
    output && typeof output === "object" && "sources" in output
      ? (output as { sources: unknown }).sources
      : output;
  if (!Array.isArray(raw)) {
    return [];
  }
  const sources: { url: string; title: string | null }[] = [];
  for (const entry of raw) {
    if (typeof entry === "object" && entry !== null) {
      const record = entry as Record<string, unknown>;
      if (typeof record.url === "string") {
        sources.push({ url: record.url, title: typeof record.title === "string" ? record.title : null });
      }
    }
  }
  return sources;
}

/**
 * How many `web_search` requests the user has spent on their local calendar day
 * (11 §cost & guardrails). Derived — no new storage — by counting the persisted
 * `web_search` tool-call entries on assistant rows, one per `server_tool_use`
 * block, which is exactly `usage.server_tool_use.web_search_requests` summed. A
 * ~48h createdAt prefilter keeps the scan bounded for any timezone's "today".
 */
async function searchesToday(
  db: Database,
  conversationId: string,
  timezone: string,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const rows = await db
    .select({ toolCalls: messages.toolCalls, createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.role, "assistant"),
        gte(messages.createdAt, since),
      ),
    );
  const today = localDate(timezone, now);
  let count = 0;
  for (const row of rows) {
    if (localDate(timezone, row.createdAt) !== today || !Array.isArray(row.toolCalls)) {
      continue;
    }
    for (const entry of row.toolCalls) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        (entry as Record<string, unknown>).toolName === WEB_SEARCH_TOOL
      ) {
        count += 1;
      }
    }
  }
  return count;
}

type PersistedCall = { toolCallId: string; toolName: string; input: unknown; result: unknown };
type ProviderResult = { toolCallId: string; toolName: string; output: unknown };

/**
 * The chat pipeline (01 steps 1–5). Persists the user message, then hands off to
 * `driveTurn` which assembles the context view and drives the model. Returns a
 * merged text stream (for SSE) and a `done` promise resolving once everything is
 * saved (the tRPC mutation awaits it).
 */
export async function beginTurn(
  services: TurnServices,
  input: {
    conversationId: string;
    text: string;
    attachmentIds?: string[];
    replyToId?: number;
  },
): Promise<{ textStream: AsyncGenerator<string>; done: Promise<TurnOutcome> }> {
  const { db, userId } = services;
  const conversation = await assertConversationOwned(db, input.conversationId, userId);
  const onboarding = conversation.kind === "onboarding";

  const insertedUser = await db
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      role: "user",
      content: input.text,
      tokenEstimate: estimateTokens(input.text),
      replyToId: input.replyToId,
    })
    .returning({ id: messages.id });
  const userMessageId = insertedUser[0]?.id;
  if (userMessageId === undefined) {
    throw new Error("failed to persist user message");
  }
  const userMessageAt = new Date();
  await db
    .update(conversations)
    .set({ lastUserMessageAt: userMessageAt })
    .where(eq(conversations.id, input.conversationId));
  await db
    .update(proactiveTurns)
    .set({ repliedAt: userMessageAt, updatedAt: userMessageAt })
    .where(
      and(
        eq(proactiveTurns.userId, userId),
        eq(proactiveTurns.status, "delivered"),
        isNull(proactiveTurns.repliedAt),
      ),
    );
  if (input.attachmentIds && input.attachmentIds.length > 0) {
    await attachAndWaitForReady(db, userId, userMessageId, input.attachmentIds);
    /**
     * Re-estimate the user message now that its attachments are ready: the tail
     * budgets (08's 8k/24k) must count the injected expansion (fenced extracts,
     * transcripts, captions), not just the typed text.
     */
    const attachmentRows = await db
      .select({
        kind: attachments.kind,
        storageKey: attachments.storageKey,
        caption: attachments.caption,
        transcript: attachments.transcript,
        extractedText: attachments.extractedText,
      })
      .from(attachments)
      .where(inArray(attachments.id, input.attachmentIds));
    const expansion = attachmentRows.reduce(
      (total, row) => total + attachmentExpansionTokens(row),
      0,
    );
    if (expansion > 0) {
      await db
        .update(messages)
        .set({ tokenEstimate: estimateTokens(input.text) + expansion })
        .where(eq(messages.id, userMessageId));
    }
  }

  return driveTurn(services, {
    conversationId: input.conversationId,
    onboarding,
    userText: input.text,
  });
}

/**
 * Resume a turn after its device-tools posted results (12-life-integrations.md).
 * No new user message: the assistant tool-call row + the client's `tool` result
 * rows are already persisted, so `buildContextView` reconstructs the paired
 * tool-call/tool-result messages (assembleTail) and the model streams the
 * follow-up text (e.g. "locked in — crush it") as the same logical turn. If the
 * follow-up itself calls another device-tool, that surfaces as a new frame and
 * the client loops again.
 */
export async function continueTurn(
  services: TurnServices,
  input: { conversationId: string },
): Promise<{ textStream: AsyncGenerator<string>; done: Promise<TurnOutcome> }> {
  const { db, userId } = services;
  const conversation = await assertConversationOwned(db, input.conversationId, userId);
  return driveTurn(services, {
    conversationId: input.conversationId,
    onboarding: conversation.kind === "onboarding",
    userText: "",
  });
}

/**
 * Swap image/PDF content parts' storage keys for the raw bytes before the model
 * call (09). The default identity `storageUrl` leaves parts holding storage
 * keys; providers can't reliably fetch our store by URL (a localhost dev store
 * is unreachable from OpenAI), so the bytes always ride inline — the AI SDK
 * encodes them per provider.
 */
async function inlineAttachmentBytes(
  modelMessages: ModelMessage[],
  storage: Storage,
): Promise<void> {
  for (const message of modelMessages) {
    if (message.role !== "user" || !Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content) {
      if (part.type === "image" && typeof part.image === "string") {
        part.image = await storage.getObject(part.image);
      } else if (part.type === "file" && typeof part.data === "string") {
        part.data = await storage.getObject(part.data);
      }
    }
  }
}

/**
 * Assemble the context view and drive the model — resending while a provider
 * tool (web search) leaves a call unresolved across a step (11) — then persist the
 * assistant message plus any provider-executed search-result rows. When the model
 * emits client (device) tool-calls it streams a device-tool frame (12) and ends
 * the turn; the client runs them and calls `continueTurn` to resume.
 */
async function driveTurn(
  services: TurnServices,
  args: { conversationId: string; onboarding: boolean; userText: string },
): Promise<{ textStream: AsyncGenerator<string>; done: Promise<TurnOutcome> }> {
  const { db, model, flags, userId, storage } = services;
  const { onboarding } = args;
  const input = { conversationId: args.conversationId, text: args.userText };

  const now = new Date();
  const userRows = await db
    .select({
      timezone: users.timezone,
      lastCity: users.lastCity,
      lastRegion: users.lastRegion,
      lastCountry: users.lastCountry,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = userRows[0];
  const timezone = user?.timezone ?? "UTC";

  const view = await buildContextView(db, input.conversationId, { flags });
  await inlineAttachmentBytes(view.messages, storage);
  const healthContextUsed = view.system.some(
    (block) => block.id === "memory" && block.text.includes(HEALTH_CONTEXT_MARKER),
  );

  /**
   * Onboarding conversations run against the restricted onboarding tool set only
   * (02 §onboarding chat): no capability registry, no device tools, no provider
   * tools — the beat machine's two commit tools are the whole surface.
   */
  const toolContext = { db, userId, conversationId: input.conversationId };
  let tools: ToolSet;
  let clientNames = new Set<string>();
  if (onboarding) {
    tools = toModelTools(onboardingTools, toolContext);
  } else {
    const spentToday = user
      ? await searchesToday(db, input.conversationId, timezone, now)
      : DAILY_SEARCH_CAP;
    const selected = selectTools(allTools, flags);
    clientNames = new Set(clientTools(selected).map((t) => t.name));
    const providerTools = selectProviderTools(capabilities, {
      flags,
      userLocation: user ? userLocationFrom({ ...user, timezone }) : undefined,
      searchWithinDailyCap: spentToday < DAILY_SEARCH_CAP,
    });
    tools = { ...toModelTools(selected, toolContext), ...providerTools };
  }

  const done = createDeferred<TurnOutcome>();

  async function persistTurn(acc: {
    fullText: string;
    calls: PersistedCall[];
    providerResults: ProviderResult[];
    deviceToolCalls: DeviceToolCall[];
    tokensIn: number;
    tokensOut: number;
    webSearchRequests: number;
    finishReason: string;
    suggestedReplies: string[];
  }): Promise<TurnOutcome> {
    const inserted = await db
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        role: "assistant",
        content: acc.fullText,
        tokenEstimate: estimateTokens(acc.fullText),
        model: modelName(model),
        promptVersion: view.promptVersion,
        tokensIn: acc.tokensIn > 0 ? acc.tokensIn : null,
        tokensOut: acc.tokensOut > 0 ? acc.tokensOut : null,
        toolCalls: acc.calls.length > 0 ? acc.calls : null,
      })
      .returning();
    const message = inserted[0];
    if (!message) {
      throw new Error("failed to persist assistant message");
    }
    if (
      healthContextUsed ||
      HEALTH_TEXT_PATTERN.test(input.text) ||
      acc.calls.some((call) => HEALTH_TOOL_NAMES.has(call.toolName))
    ) {
      await markMessagesSensitive(db, [message.id]);
    }

    /**
     * Provider-executed search results land as their own `tool` rows *after* the
     * assistant row, so the derived-view assembler (08) round-trips their
     * `encrypted_content` blocks verbatim while they sit in the tail. Server-tool
     * results stay inlined on the assistant row and are dropped from the tail as
     * before.
     */
    for (const result of acc.providerResults) {
      const content = JSON.stringify(result.output);
      await db.insert(messages).values({
        conversationId: input.conversationId,
        role: "tool",
        content,
        tokenEstimate: estimateTokens(content),
        toolCalls: [{ toolCallId: result.toolCallId, toolName: result.toolName }],
      });
    }

    if (acc.webSearchRequests > 0 || acc.providerResults.length > 0) {
      console.info(
        JSON.stringify({
          event: "chat.turn.search",
          conversationId: input.conversationId,
          messageId: message.id,
          tokensIn: acc.tokensIn,
          tokensOut: acc.tokensOut,
          webSearchRequests: acc.webSearchRequests,
        }),
      );
    }

    const needsCompaction = (await tailTokens(db, input.conversationId)) > TAIL_MAX_TOKENS;
    return {
      message,
      deviceToolCalls: acc.deviceToolCalls,
      finishReason: acc.finishReason,
      suggestedReplies: acc.suggestedReplies,
      needsCompaction,
    };
  }

  async function* drive(): AsyncGenerator<string> {
    try {
      const convo = [...view.messages];
      const callsById = new Map<string, PersistedCall>();
      const providerResults: ProviderResult[] = [];
      const deviceToolCalls: DeviceToolCall[] = [];
      let fullText = "";
      let tokensIn = 0;
      let tokensOut = 0;
      let webSearchRequests = 0;
      let finishReason = "stop";
      let searching = false;

      for (let attempt = 0; attempt < MAX_TURN_ATTEMPTS; attempt += 1) {
        /**
         * Capture stream errors here rather than letting them surface as
         * unhandled rejections: `streamText` reports a mid-stream failure (an
         * API 400, a dropped connection) through `onError`, and without this the
         * rejecting internal promises take down the whole process. We record it
         * and rethrow below so the turn fails for this one request — the outer
         * `try/catch` rejects `done`, and the tRPC handler returns the error.
         */
        let streamError: unknown;
        const result = streamText({
          model,
          system: renderSystem(view.system),
          messages: convo,
          tools,
          stopWhen: stepCountIs(8),
          onError: ({ error }) => {
            streamError = error;
          },
        });
        /**
         * Drain the full stream so we can slip the "looking it up…" control frames
         * (11) between text deltas: a search's `tool-input-start` opens the caption,
         * its `tool-result` closes it. Everything else is ignored here and read back
         * from `result.steps` below.
         */
        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            fullText += part.text;
            yield part.text;
          } else if (part.type === "tool-input-start" && part.providerExecuted === true) {
            if (!searching) {
              searching = true;
              yield SEARCH_STREAM_START;
            }
          } else if (
            part.type === "tool-result" &&
            PROVIDER_TOOL_NAMES.has(part.toolName) &&
            searching
          ) {
            searching = false;
            yield SEARCH_STREAM_END;
          }
        }
        if (streamError) {
          throw streamError;
        }
        const [steps, usage, response, reason] = await Promise.all([
          result.steps,
          result.usage,
          result.response,
          result.finishReason,
        ]);
        finishReason = reason;
        tokensIn += usage.inputTokens ?? 0;
        tokensOut += usage.outputTokens ?? 0;

        const resolvedIds = new Set<string>();
        const pendingProviderCalls: string[] = [];
        for (const step of steps) {
          for (const part of step.content) {
            if (part.type === "tool-call") {
              if (!callsById.has(part.toolCallId)) {
                callsById.set(part.toolCallId, {
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  input: part.input,
                  result: null,
                });
              }
              if (part.providerExecuted === true) {
                pendingProviderCalls.push(part.toolCallId);
              } else if (
                clientNames.has(part.toolName) &&
                !deviceToolCalls.some((d) => d.toolCallId === part.toolCallId)
              ) {
                deviceToolCalls.push({
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  input: part.input,
                });
              }
            } else if (part.type === "tool-result") {
              resolvedIds.add(part.toolCallId);
              const call = callsById.get(part.toolCallId);
              if (PROVIDER_TOOL_NAMES.has(part.toolName)) {
                providerResults.push({
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  output: part.output,
                });
                if (part.toolName === WEB_SEARCH_TOOL) {
                  webSearchRequests += 1;
                }
                if (call) {
                  call.result =
                    part.toolName === WEB_SEARCH_TOOL ? webSearchSources(part.output) : null;
                }
              } else if (call) {
                call.result = part.output;
              }
            } else if (part.type === "tool-error") {
              resolvedIds.add(part.toolCallId);
            }
          }
        }

        const paused = pendingProviderCalls.some((id) => !resolvedIds.has(id));
        if (!paused) {
          break;
        }
        for (const responseMessage of response.messages) {
          convo.push(responseMessage);
        }
      }

      /**
       * Device tools (12): the model asked the app to run native ops it can't
       * execute server-side. Stream the calls so the client runs them and posts
       * results; the assistant tool-call row persists below, and the client calls
       * `continueTurn` once results land to stream the follow-up text.
       */
      if (deviceToolCalls.length > 0) {
        yield encodeDeviceToolCalls(deviceToolCalls);
      }

      /**
       * Post-hoc reply chips (07 §2) + the onboarding beat. For onboarding turns
       * the beat is recomputed AFTER the commit tools ran, so the frame tells the
       * client where the state machine now stands (its push-permission UI keys
       * off `wrap_up`), and the catalog options for the current beat steer the
       * chip generator toward the plan's scripted choices.
       */
      const accumulated = {
        fullText,
        calls: [...callsById.values()],
        providerResults,
        deviceToolCalls,
        finishReason,
      };
      let onboardingBeat: string | undefined;
      let optionHints: string[] = [];
      if (onboarding) {
        const state = await onboardingChatState(db, userId);
        onboardingBeat = state.beat.type;
        optionHints = beatChipHints(state);
      }
      let suggestedReplies: string[] = [];
      if (isToolEnabled(SUGGESTED_REPLIES_FLAG, flags) && repliesEligible(accumulated)) {
        suggestedReplies = await suggestReplies(services.replyModel ?? model, {
          userText: input.text,
          assistantText: fullText,
          optionHints,
        });
      }
      if (suggestedReplies.length > 0 || onboardingBeat !== undefined) {
        yield encodeStreamMeta({ replies: suggestedReplies, beat: onboardingBeat });
      }

      const outcome = await persistTurn({
        ...accumulated,
        tokensIn,
        tokensOut,
        webSearchRequests,
        suggestedReplies,
      });
      done.resolve(outcome);
    } catch (error) {
      done.reject(error);
      throw error;
    }
  }

  return { textStream: drive(), done: done.promise };
}

/** Non-streaming turn: drives the model to completion and returns the outcome. */
export async function sendChatTurn(
  services: TurnServices,
  input: {
    conversationId: string;
    text: string;
    attachmentIds?: string[];
    replyToId?: number;
  },
): Promise<TurnOutcome> {
  const { textStream, done } = await beginTurn(services, input);
  for await (const _delta of textStream) {
    void _delta;
  }
  return done;
}

export async function chatHistory(
  db: Database,
  userId: string,
  input: { conversationId: string; cursor?: number; limit: number },
): Promise<MessageRow[]> {
  await assertConversationOwned(db, input.conversationId, userId);
  const base = eq(messages.conversationId, input.conversationId);
  const where = input.cursor ? and(base, lt(messages.id, input.cursor)) : base;
  return db.select().from(messages).where(where).orderBy(desc(messages.id)).limit(input.limit);
}

/**
 * `chat.historyAround` (08 §jump-to-date): the target message plus `span`
 * messages on each side, returned ascending (chronological) for the centered
 * thread view. Powers search-result deep links and the day picker.
 */
export async function chatHistoryAround(
  db: Database,
  userId: string,
  input: { conversationId: string; messageId: number; span: number },
): Promise<MessageRow[]> {
  await assertConversationOwned(db, input.conversationId, userId);
  const base = eq(messages.conversationId, input.conversationId);
  const older = await db
    .select()
    .from(messages)
    .where(and(base, lte(messages.id, input.messageId)))
    .orderBy(desc(messages.id))
    .limit(input.span + 1);
  const newer = await db
    .select()
    .from(messages)
    .where(and(base, gt(messages.id, input.messageId)))
    .orderBy(asc(messages.id))
    .limit(input.span);
  return [...older.reverse(), ...newer];
}

export type SearchHit = {
  id: number;
  conversationId: string;
  role: string;
  content: string;
  createdAt: Date;
  snippet: string;
};

/**
 * `chat.search` (08 §message search): Postgres FTS over the immutable message
 * log via the generated `content_tsv` GIN index, newest-first, each hit carrying
 * a `ts_headline` snippet with the match `<b>`-bolded for the results list.
 */
export async function chatSearch(
  db: Database,
  userId: string,
  input: { conversationId: string; query: string; limit: number },
): Promise<SearchHit[]> {
  await assertConversationOwned(db, input.conversationId, userId);
  const matches = sql`${messages.contentTsv} @@ websearch_to_tsquery('english', ${input.query})`;
  return db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
      snippet: sql<string>`ts_headline('english', ${messages.content}, websearch_to_tsquery('english', ${input.query}))`,
    })
    .from(messages)
    .where(and(eq(messages.conversationId, input.conversationId), matches))
    .orderBy(desc(messages.id))
    .limit(input.limit);
}

/**
 * The app returning a device-tool's result (12-life-integrations.md). Persists it
 * as a `tool` message paired (by `toolCallId`) to the assistant's tool-call row, so
 * `buildContextView`/assembleTail reconstruct the pair and the continuation turn
 * sees a valid tool-call → tool-result sequence. Idempotent: a repeated post for a
 * `toolCallId` that already has a result row returns that row instead of inserting
 * a duplicate — the client can retry (or double-fire) freely.
 */
export async function recordDeviceToolResult(
  db: Database,
  userId: string,
  input: DeviceToolResultInput,
): Promise<{ ok: true; messageId: number }> {
  await assertConversationOwned(db, input.conversationId, userId);
  const existing = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, input.conversationId),
        eq(messages.role, "tool"),
        sql`${messages.toolCalls} @> ${JSON.stringify([{ toolCallId: input.toolCallId }])}`,
      ),
    )
    .limit(1);
  if (existing[0]) {
    return { ok: true, messageId: existing[0].id };
  }
  const content = JSON.stringify(input.result ?? null);
  const inserted = await db
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      role: "tool",
      content,
      tokenEstimate: estimateTokens(content),
      toolCalls: [{ toolCallId: input.toolCallId, toolName: input.toolName }],
    })
    .returning({ id: messages.id });
  const row = inserted[0];
  if (!row) {
    throw new Error("failed to persist device tool result");
  }
  return { ok: true, messageId: row.id };
}
