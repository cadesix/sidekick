import { type LanguageModel, generateObject } from "ai";
import { and, asc, eq } from "drizzle-orm";
import {
  type Database,
  conversations,
  memories,
  memorySuppressions,
  purchaseIntents,
} from "@sidekick/db";
import {
  EXTRACTION_PROMPT,
  type MemoryKind,
  type MemoryOp,
  PURCHASE_INTENT_TTL_DAYS,
  bumpMemoryVersion,
  memoryOpsSchema,
  tailMessages,
} from "@sidekick/shared";

export type ExtractionResult = {
  applied: number;
  newWatermark: number;
  advanced: boolean;
};

function normalize(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

function transcriptLine(role: string, content: string): string {
  if (role === "user") {
    return `user: ${content}`;
  }
  if (role === "assistant") {
    return `sidekick: ${content}`;
  }
  return `tool: ${content}`;
}

/**
 * Async memory extraction (user-memory.md §2). One cheap-model call per idle
 * session turns the new transcript into `apply_memory_ops`, applied server-side
 * with the plan's rules (suppression-checked add, supersession chain, reinforce,
 * expire). Advances `conversations.lastExtractedMessageId` to cover every message
 * it read — this watermark is the ceiling the compaction watermark may never pass
 * (the ordering invariant), so extraction MUST run before compaction in the idle
 * job. Bumps `users.memory_version` once if anything changed.
 */
export async function runExtraction(
  db: Database,
  model: LanguageModel,
  conversationId: string,
  options: { now?: Date } = {},
): Promise<ExtractionResult> {
  const now = options.now ?? new Date();

  const conversationRows = await db
    .select({
      userId: conversations.userId,
      lastExtractedMessageId: conversations.lastExtractedMessageId,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const conversation = conversationRows[0];
  if (!conversation) {
    return { applied: 0, newWatermark: 0, advanced: false };
  }

  const watermark = conversation.lastExtractedMessageId ?? 0;
  const newMessages = await tailMessages(db, conversationId, watermark);
  if (newMessages.length === 0) {
    return { applied: 0, newWatermark: watermark, advanced: false };
  }
  const newWatermark = newMessages[newMessages.length - 1]?.id ?? watermark;

  const userId = conversation.userId;
  const activeMemories = await db
    .select({ id: memories.id, kind: memories.kind, content: memories.content })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.status, "active")))
    .orderBy(asc(memories.createdAt));
  const suppressions = await db
    .select({ content: memorySuppressions.content })
    .from(memorySuppressions)
    .where(eq(memorySuppressions.userId, userId));

  const prompt = EXTRACTION_PROMPT.build({
    activeMemories: activeMemories.map((m) => `${m.id} · ${m.kind} · ${m.content}`).join("\n"),
    suppressions: suppressions.map((s) => `- ${s.content}`).join("\n"),
    transcript: newMessages.map((m) => transcriptLine(m.role, m.content)).join("\n"),
  });

  const { object } = await generateObject({ model, schema: memoryOpsSchema, prompt });

  const suppressed = new Set(suppressions.map((s) => normalize(s.content)));
  const activeIds = new Set(activeMemories.map((m) => m.id));
  let applied = 0;
  for (const op of object.ops) {
    const didApply = await applyOp(db, {
      op,
      userId,
      conversationId,
      suppressed,
      activeIds,
      now,
    });
    if (didApply) {
      applied += 1;
    }
  }

  await db
    .update(conversations)
    .set({ lastExtractedMessageId: newWatermark })
    .where(eq(conversations.id, conversationId));

  if (applied > 0) {
    await bumpMemoryVersion(db, userId);
  }

  return { applied, newWatermark, advanced: true };
}

type ApplyContext = {
  op: MemoryOp;
  userId: string;
  conversationId: string;
  suppressed: Set<string>;
  activeIds: Set<string>;
  now: Date;
};

function extractedMemory(ctx: ApplyContext, kind: MemoryKind, content: string) {
  return {
    userId: ctx.userId,
    kind,
    content,
    eventDate: ctx.op.event_date ?? null,
    confidence: ctx.op.confidence ?? "stated",
    source: "extraction",
    sourceSessionId: ctx.conversationId,
  };
}

async function applyOp(db: Database, ctx: ApplyContext): Promise<boolean> {
  const { op } = ctx;

  if (op.op === "add") {
    if (!op.content || !op.kind || ctx.suppressed.has(normalize(op.content))) {
      return false;
    }
    await db.insert(memories).values(extractedMemory(ctx, op.kind, op.content));
    return true;
  }

  if (op.op === "supersede") {
    if (!op.memory_id || !op.content || !op.kind || !ctx.activeIds.has(op.memory_id)) {
      return false;
    }
    await db
      .insert(memories)
      .values({ ...extractedMemory(ctx, op.kind, op.content), supersedesId: op.memory_id });
    await db.update(memories).set({ status: "superseded" }).where(eq(memories.id, op.memory_id));
    return true;
  }

  if (op.op === "reinforce") {
    if (!op.memory_id || !ctx.activeIds.has(op.memory_id)) {
      return false;
    }
    const patch: { lastReinforcedAt: Date; confidence?: string } = { lastReinforcedAt: ctx.now };
    if (op.confidence === "stated") {
      patch.confidence = "stated";
    }
    await db.update(memories).set(patch).where(eq(memories.id, op.memory_id));
    return true;
  }

  if (op.op === "expire") {
    if (!op.memory_id || !ctx.activeIds.has(op.memory_id)) {
      return false;
    }
    await db.update(memories).set({ status: "expired" }).where(eq(memories.id, op.memory_id));
    return true;
  }

  if (op.op === "intent") {
    if (!op.content) {
      return false;
    }
    const expiresAt = new Date(ctx.now.getTime() + PURCHASE_INTENT_TTL_DAYS * 24 * 60 * 60 * 1000);
    await db.insert(purchaseIntents).values({
      userId: ctx.userId,
      signal: op.content,
      strength: op.strength ?? "active",
      expiresAt,
      sourceSessionId: ctx.conversationId,
    });
    return true;
  }

  return false;
}
