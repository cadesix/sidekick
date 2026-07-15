import { and, desc, eq, inArray } from "drizzle-orm";
import {
  type Database,
  conversations,
  devicePushTokens,
  messages,
  notificationOutbox,
  proactiveTurns,
  users,
} from "@sidekick/db";
import { estimateTokens } from "@sidekick/shared";
import type { LanguageModel } from "ai";
import { notificationBody } from "../notifications/policy";
import { generateProactiveBubbles, PROACTIVE_PROMPT_VERSION } from "./generator";
import {
  dueProactiveTurns,
  proactiveCancellationReason,
} from "./scheduler";

const SIX_HOURS_MS = 6 * 60 * 60_000;

async function recentContext(db: Database, conversationId: string) {
  return db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.id))
    .limit(20);
}

async function recentProactive(db: Database, userId: string): Promise<string[]> {
  const turns = await db
    .select({ id: proactiveTurns.id })
    .from(proactiveTurns)
    .where(and(eq(proactiveTurns.userId, userId), eq(proactiveTurns.status, "delivered")))
    .orderBy(desc(proactiveTurns.scheduledFor))
    .limit(5);
  if (turns.length === 0) {
    return [];
  }
  const rows = await db
    .select({ content: messages.content })
    .from(messages)
    .where(inArray(messages.proactiveTurnId, turns.map((turn) => turn.id)))
    .orderBy(desc(messages.id));
  return rows.map((row) => row.content);
}

export async function dispatchProactiveTurn(
  db: Database,
  model: LanguageModel,
  turn: typeof proactiveTurns.$inferSelect,
  now: Date = new Date(),
): Promise<{ delivered: boolean; reason?: string; messages?: number }> {
  const claimed = await db
    .update(proactiveTurns)
    .set({ status: "generating", updatedAt: now })
    .where(and(eq(proactiveTurns.id, turn.id), eq(proactiveTurns.status, "scheduled")))
    .returning({ id: proactiveTurns.id });
  if (!claimed[0]) {
    return { delivered: false, reason: "claimed" };
  }
  const cancellation = await proactiveCancellationReason(db, turn, now);
  if (cancellation) {
    await db
      .update(proactiveTurns)
      .set({ status: "cancelled", cancellationReason: cancellation, updatedAt: now })
      .where(eq(proactiveTurns.id, turn.id));
    return { delivered: false, reason: cancellation };
  }

  const profile = await db
    .select({ name: users.name, sidekickName: users.sidekickName })
    .from(users)
    .where(eq(users.id, turn.userId))
    .limit(1);
  const user = profile[0];
  if (!user) {
    return { delivered: false, reason: "missing-user" };
  }
  let bubbles: string[];
  try {
    bubbles = await generateProactiveBubbles(model, {
      sidekickName: user.sidekickName ?? "Sidekick",
      userName: user.name,
      recentMessages: (await recentContext(db, turn.conversationId)).reverse(),
      recentProactiveMessages: await recentProactive(db, turn.userId),
    });
  } catch {
    await db
      .update(proactiveTurns)
      .set({ status: "failed", cancellationReason: "generation-failed", updatedAt: now })
      .where(eq(proactiveTurns.id, turn.id));
    return { delivered: false, reason: "generation-failed" };
  }

  const conversation = await db
    .select({ lastUserMessageAt: conversations.lastUserMessageAt })
    .from(conversations)
    .where(eq(conversations.id, turn.conversationId))
    .limit(1);
  if (
    conversation[0]?.lastUserMessageAt?.getTime() !== turn.eligibilityUserMessageAt.getTime()
  ) {
    await db
      .update(proactiveTurns)
      .set({ status: "cancelled", cancellationReason: "user-returned", updatedAt: now })
      .where(eq(proactiveTurns.id, turn.id));
    return { delivered: false, reason: "user-returned" };
  }

  const tokens = await db
    .select({ id: devicePushTokens.id })
    .from(devicePushTokens)
    .where(and(eq(devicePushTokens.userId, turn.userId), eq(devicePushTokens.status, "active")));
  await db.transaction(async (tx) => {
    for (let sequence = 0; sequence < bubbles.length; sequence += 1) {
      const content = bubbles[sequence];
      if (!content) {
        continue;
      }
      const inserted = await tx
        .insert(messages)
        .values({
          conversationId: turn.conversationId,
          role: "assistant",
          content,
          tokenEstimate: estimateTokens(content),
          promptVersion: PROACTIVE_PROMPT_VERSION,
          proactiveTurnId: turn.id,
          proactiveSequence: sequence,
        })
        .returning({ id: messages.id });
      const message = inserted[0];
      if (!message) {
        throw new Error("failed to persist proactive message");
      }
      if (tokens.length > 0) {
        await tx.insert(notificationOutbox).values(
          tokens.map((token) => ({
            userId: turn.userId,
            devicePushTokenId: token.id,
            messageId: message.id,
            kind: "proactive-message",
            title: user.sidekickName ?? "Sidekick",
            body: notificationBody(content, sequence),
            data: {
              type: "proactive-message",
              conversationId: turn.conversationId,
              messageId: message.id,
              proactiveTurnId: turn.id,
              sequence,
              notificationThreadId: `conversation-${turn.conversationId}`,
              url: `/?messageId=${message.id}`,
            },
            availableAt: now,
            expiresAt: new Date(now.getTime() + SIX_HOURS_MS),
          })),
        );
      }
    }
    await tx
      .update(proactiveTurns)
      .set({ status: "delivered", promptVersion: PROACTIVE_PROMPT_VERSION, updatedAt: now })
      .where(eq(proactiveTurns.id, turn.id));
  });
  return { delivered: true, messages: bubbles.length };
}

export async function dispatchDueProactiveTurns(
  db: Database,
  model: LanguageModel,
  now: Date = new Date(),
): Promise<{ due: number; delivered: number }> {
  const due = await dueProactiveTurns(db, now);
  const outcomes = await Promise.all(
    due.map((turn) => dispatchProactiveTurn(db, model, turn, now)),
  );
  return { due: due.length, delivered: outcomes.filter((outcome) => outcome.delivered).length };
}
