import { and, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs, type LanguageModel } from "ai";
import {
  type Database,
  actionItems,
  checkIns,
  goals,
  memories,
  messages,
  notificationPreferences,
  progressEvents,
  users,
} from "@sidekick/db";
import {
  DEFAULT_REMINDER_TIME,
  WEB_SEARCH_CONTEXT_SIZE,
  WEB_SEARCH_TOOL,
  addDays,
  bumpMemoryVersion,
  estimateTokens,
  localDate,
  localHour,
  pickTone,
  renderOpenerSystem,
  renderOpenerUser,
  weekStart,
  type OpenerSignal,
} from "@sidekick/shared";
import { ensureMainConversation, userLocationFrom, webSearchSources } from "../chat/turn";
import { userStreak } from "../rewards/service";

/** Opener proactivity budget (11 §current-events proactivity): at most 2 searched openers/user/week. */
const OPENER_SEARCH_WEEKLY_CAP = 2;

/**
 * The single line that turns a daily opener into a current-events opener (11).
 * Only added when the user is under their weekly budget and the search tool is
 * actually attached, so the model can weave in real news when one of their
 * interests plausibly had some.
 */
const OPENER_SEARCH_INSTRUCTION =
  "If one of their interests plausibly had real news in the last day or two (a game released, their team played, an artist dropped something), you may run ONE quick web search and open with it — but only when it genuinely fits. Otherwise don't search; a normal warm opener is always fine.";

type PersistedOpenerCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
  result: unknown;
};
import { getWeather } from "./weather";
import { enqueueNotification } from "../notifications/outbox";
import { GENERIC_PROACTIVE_BODY } from "../notifications/policy";

type UserRow = typeof users.$inferSelect;

/** Everything the check-in engine needs. Env-derived keys are optional so tests inject none. */
export type CheckinDeps = {
  db: Database;
  model: LanguageModel;
  weatherApiKey?: string;
};

/** Local hour after which the quiet-failure follow-up is allowed to fire. */
export const FOLLOWUP_HOUR = 19;

/** Soft evening nudges — the single extra push a quiet day is allowed. */
const FOLLOWUP_MESSAGES = [
  "no stress, just thinking about u 💛",
  "hey, no pressure — just checking in on my favorite person",
  "here whenever u wanna talk about the day 🙂",
  "hope today was ok. i'm around if u want to chat",
];

function reminderHour(user: UserRow): number {
  const time = user.reminderTime ?? DEFAULT_REMINDER_TIME;
  return Number(time.split(":")[0]) % 24;
}

/**
 * Timezone shard for a cron tick (01: "users whose local reminder time is now").
 * A user is due when their local hour equals their reminder hour — hourly
 * sharding that's robust to minute drift between ticks.
 */
export async function selectDueUsers(db: Database, now: Date): Promise<UserRow[]> {
  const rows = await db
    .select({ user: users })
    .from(users)
    .innerJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
    .where(eq(notificationPreferences.checkinsEnabled, true));
  const all = rows.map((row) => row.user);
  return all.filter((user) => localHour(user.timezone, now) === reminderHour(user));
}

/**
 * Users with an opened, still-uncompleted check-in for their local today, in the
 * evening window — the candidates for the single soft follow-up push.
 */
export async function selectFollowUpCandidates(db: Database, now: Date): Promise<UserRow[]> {
  const rows = await db
    .select({ user: users, date: checkIns.date })
    .from(checkIns)
    .innerJoin(users, eq(checkIns.userId, users.id))
    .innerJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
    .where(
      and(
        eq(checkIns.status, "opened"),
        eq(notificationPreferences.checkinsEnabled, true),
      ),
    );
  return rows
    .filter(
      (r) =>
        r.date === localDate(r.user.timezone, now) &&
        localHour(r.user.timezone, now) >= FOLLOWUP_HOUR,
    )
    .map((r) => r.user);
}

function dayOfWeek(timezone: string, at: Date): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(at);
  return name.toLowerCase();
}

async function gatherOpenerSignals(
  deps: CheckinDeps,
  user: UserRow,
  today: string,
): Promise<{ signals: OpenerSignal[]; streak: number; yesterdaySkipped: boolean }> {
  const { db } = deps;
  const yesterday = addDays(today, -1);

  const [yesterdayCheckIn, yesterdayProgress, streak, highlights, weather] = await Promise.all([
    db
      .select({ status: checkIns.status })
      .from(checkIns)
      .where(and(eq(checkIns.userId, user.id), eq(checkIns.date, yesterday)))
      .limit(1),
    db
      .select({
        label: actionItems.label,
        outcome: progressEvents.outcome,
        note: progressEvents.note,
      })
      .from(progressEvents)
      .innerJoin(actionItems, eq(progressEvents.actionItemId, actionItems.id))
      .innerJoin(goals, eq(actionItems.goalId, goals.id))
      .where(and(eq(goals.userId, user.id), eq(progressEvents.date, yesterday))),
    userStreak(db, user.id, today),
    db
      .select({ content: memories.content, kind: memories.kind })
      .from(memories)
      .where(and(eq(memories.userId, user.id), eq(memories.status, "active")))
      .orderBy(desc(memories.lastReinforcedAt))
      .limit(3),
    getWeather(deps.weatherApiKey, user.lastCity ?? null),
  ]);
  const yesterdaySkipped = yesterdayCheckIn[0]?.status === "skipped";

  const signals: OpenerSignal[] = [];
  const notable = yesterdayProgress.find((p) => p.outcome === "hit" || p.outcome === "missed");
  if (notable) {
    const color = notable.note ? ` (${notable.note})` : "";
    signals.push({
      label: "yesterday",
      detail: `${notable.label}: ${notable.outcome}${color}`,
    });
  }
  for (const h of highlights) {
    signals.push({ label: h.kind, detail: h.content });
  }
  if (weather) {
    signals.push({ label: "weather", detail: weather });
  }
  if (streak >= 2) {
    signals.push({ label: "streak", detail: `${streak}-day streak going` });
  }

  return { signals, streak, yesterdaySkipped };
}

async function recentOpenerTexts(db: Database, userId: string, limit: number): Promise<string[]> {
  const recent = await db
    .select({ openerMessageId: checkIns.openerMessageId })
    .from(checkIns)
    .where(and(eq(checkIns.userId, userId), sql`${checkIns.openerMessageId} is not null`))
    .orderBy(desc(checkIns.date))
    .limit(limit);
  const ids = recent.map((r) => r.openerMessageId).filter((id): id is number => id !== null);
  if (ids.length === 0) {
    return [];
  }
  const rows = await db
    .select({ content: messages.content })
    .from(messages)
    .where(inArray(messages.id, ids));
  return rows.map((r) => r.content);
}

async function countCheckins(db: Database, userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(checkIns)
    .where(eq(checkIns.userId, userId));
  return rows[0]?.count ?? 0;
}

/**
 * How many of the user's openers this rolling week used web search (11). Derived
 * from the persisted opener `toolCalls` — no new storage — so it's the exact
 * budget the 2×/week cap gates on.
 */
async function openerSearchesThisWeek(
  db: Database,
  userId: string,
  today: string,
): Promise<number> {
  const rows = await db
    .select({ openerMessageId: checkIns.openerMessageId })
    .from(checkIns)
    .where(
      and(
        eq(checkIns.userId, userId),
        gte(checkIns.date, weekStart(today)),
        sql`${checkIns.openerMessageId} is not null`,
      ),
    );
  const ids = rows.map((r) => r.openerMessageId).filter((id): id is number => id !== null);
  if (ids.length === 0) {
    return 0;
  }
  const opened = await db
    .select({ toolCalls: messages.toolCalls })
    .from(messages)
    .where(inArray(messages.id, ids));
  let count = 0;
  for (const row of opened) {
    if (
      Array.isArray(row.toolCalls) &&
      row.toolCalls.some(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as Record<string, unknown>).toolName === WEB_SEARCH_TOOL,
      )
    ) {
      count += 1;
    }
  }
  return count;
}

export async function generateOpener(
  deps: CheckinDeps,
  user: UserRow,
  now: Date,
): Promise<{ text: string; toolCalls: PersistedOpenerCall[] | null }> {
  const today = localDate(user.timezone, now);
  const [{ signals, yesterdaySkipped }, recentOpeners, priorCount, openerSearches] =
    await Promise.all([
      gatherOpenerSignals(deps, user, today),
      recentOpenerTexts(deps.db, user.id, 5),
      countCheckins(deps.db, user.id),
      openerSearchesThisWeek(deps.db, user.id, today),
    ]);

  const input = {
    sidekickName: user.sidekickName ?? "your sidekick",
    userName: user.name,
    tone: pickTone(priorCount),
    dayOfWeek: dayOfWeek(user.timezone, now),
    signals,
    yesterdaySkipped,
    recentOpeners,
  };

  const canSearch = openerSearches < OPENER_SEARCH_WEEKLY_CAP;
  const system = canSearch
    ? `${renderOpenerSystem(input)}\n\n${OPENER_SEARCH_INSTRUCTION}`
    : renderOpenerSystem(input);
  const tools = canSearch
    ? {
        [WEB_SEARCH_TOOL]: openai.tools.webSearch({
          searchContextSize: WEB_SEARCH_CONTEXT_SIZE,
          userLocation: userLocationFrom(user),
        }),
      }
    : undefined;

  const { text, toolCalls, toolResults } = await generateText({
    model: deps.model,
    system,
    prompt: renderOpenerUser(input),
    tools,
    stopWhen: stepCountIs(3),
  });

  const resultByCallId = new Map(toolResults.map((r) => [r.toolCallId, r.output]));
  const persisted: PersistedOpenerCall[] = toolCalls.map((call) => ({
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    input: call.input,
    result:
      call.toolName === WEB_SEARCH_TOOL
        ? webSearchSources(resultByCallId.get(call.toolCallId))
        : null,
  }));

  return { text: text.trim(), toolCalls: persisted.length > 0 ? persisted : null };
}

export type OpenOutcome =
  | { created: false; reason: "already-open" }
  | { created: true; checkInId: string; messageId: number };

/**
 * Generate and insert today's opener for one user, idempotently (03 step 3).
 * The check-in row is claimed first with `onConflictDoNothing`, so a re-run of
 * the cron for the same local day is a no-op — never a second message or push.
 */
export async function openCheckin(
  deps: CheckinDeps,
  user: UserRow,
  now: Date,
): Promise<OpenOutcome> {
  const { db } = deps;
  const date = localDate(user.timezone, now);

  const claim = await db
    .insert(checkIns)
    .values({ userId: user.id, date, status: "pending" })
    .onConflictDoNothing({ target: [checkIns.userId, checkIns.date] })
    .returning({ id: checkIns.id });
  const claimed = claim[0];
  if (!claimed) {
    return { created: false, reason: "already-open" };
  }

  const conversation = await ensureMainConversation(db, user.id);
  const { text, toolCalls } = await generateOpener(deps, user, now);

  const inserted = await db
    .insert(messages)
    .values({
      conversationId: conversation.id,
      role: "assistant",
      content: text,
      tokenEstimate: estimateTokens(text),
      toolCalls,
    })
    .returning({ id: messages.id });
  const message = inserted[0];
  if (!message) {
    throw new Error("failed to persist opener message");
  }

  await db
    .update(checkIns)
    .set({ status: "opened", openerMessageId: message.id })
    .where(eq(checkIns.id, claimed.id));
  await bumpMemoryVersion(db, user.id);

  await enqueueNotification(db, {
    userId: user.id,
    messageId: message.id,
    kind: "checkin",
    title: user.sidekickName ?? "Sidekick",
    body: GENERIC_PROACTIVE_BODY,
    data: { type: "checkin", conversationId: conversation.id, date, messageId: message.id },
    availableAt: now,
    expiresAt: new Date(now.getTime() + 6 * 60 * 60_000),
  });

  return { created: true, checkInId: claimed.id, messageId: message.id };
}

export type FollowUpOutcome =
  | { sent: false; reason: "too-early" | "no-open-checkin" | "closed" | "engaged" | "already-nudged" }
  | { sent: true; messageId: number };

/**
 * The single soft evening follow-up (03 step 4, "never more than 2 pushes/day").
 * Uses the message log as source of truth: if the user replied we stay quiet, if
 * a follow-up already exists we don't repeat it, so this is safe to run each tick.
 */
export async function followUpCheckin(
  deps: CheckinDeps,
  user: UserRow,
  now: Date,
): Promise<FollowUpOutcome> {
  const { db } = deps;
  if (localHour(user.timezone, now) < FOLLOWUP_HOUR) {
    return { sent: false, reason: "too-early" };
  }
  const date = localDate(user.timezone, now);
  const rows = await db
    .select()
    .from(checkIns)
    .where(and(eq(checkIns.userId, user.id), eq(checkIns.date, date)))
    .limit(1);
  const checkIn = rows[0];
  if (!checkIn?.openerMessageId) {
    return { sent: false, reason: "no-open-checkin" };
  }
  if (checkIn.status === "completed" || checkIn.status === "skipped") {
    return { sent: false, reason: "closed" };
  }

  const conversation = await ensureMainConversation(db, user.id);
  const since = await db
    .select({ role: messages.role })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversation.id),
        gt(messages.id, checkIn.openerMessageId),
      ),
    );
  if (since.some((m) => m.role === "user")) {
    return { sent: false, reason: "engaged" };
  }
  if (since.some((m) => m.role === "assistant")) {
    return { sent: false, reason: "already-nudged" };
  }

  const priorCount = await countCheckins(db, user.id);
  const text =
    FOLLOWUP_MESSAGES[priorCount % FOLLOWUP_MESSAGES.length] ?? "no stress, just thinking about u 💛";
  const inserted = await db
    .insert(messages)
    .values({
      conversationId: conversation.id,
      role: "assistant",
      content: text,
      tokenEstimate: estimateTokens(text),
    })
    .returning({ id: messages.id });
  const message = inserted[0];
  if (!message) {
    throw new Error("failed to persist follow-up message");
  }

  await enqueueNotification(db, {
    userId: user.id,
    messageId: message.id,
    kind: "checkin-followup",
    title: user.sidekickName ?? "Sidekick",
    body: GENERIC_PROACTIVE_BODY,
    data: {
      type: "checkin-followup",
      conversationId: conversation.id,
      date,
      messageId: message.id,
    },
    availableAt: now,
    expiresAt: new Date(now.getTime() + 6 * 60 * 60_000),
  });

  return { sent: true, messageId: message.id };
}

/**
 * Auto-close check-ins whose local day has passed as `skipped` (03 step 4,
 * "at local midnight"). Tomorrow's opener can reference the skip gently.
 */
export async function closeStaleCheckins(db: Database, now: Date): Promise<{ closed: number }> {
  const rows = await db
    .select({ id: checkIns.id, date: checkIns.date, timezone: users.timezone })
    .from(checkIns)
    .innerJoin(users, eq(checkIns.userId, users.id))
    .where(inArray(checkIns.status, ["pending", "opened"]));

  const staleIds = rows
    .filter((r) => r.date < localDate(r.timezone, now))
    .map((r) => r.id);
  if (staleIds.length === 0) {
    return { closed: 0 };
  }
  await db.update(checkIns).set({ status: "skipped" }).where(inArray(checkIns.id, staleIds));
  return { closed: staleIds.length };
}
