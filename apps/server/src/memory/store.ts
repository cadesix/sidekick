import { TRPCError } from "@trpc/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { type Database, memories, memorySuppressions, users } from "@sidekick/db";

export type MemoryListItem = {
  id: string;
  kind: string;
  content: string;
  confidence: string;
  source: string;
  eventDate: string | null;
  createdAt: Date;
};

/** Bump the sync/cache primitive after any change to a user's memory set. */
export async function bumpMemoryVersion(db: Database, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ memoryVersion: sql`${users.memoryVersion} + 1` })
    .where(eq(users.id, userId));
}

async function ownedActiveMemory(
  db: Database,
  userId: string,
  memoryId: string,
): Promise<{ id: string; kind: string; content: string }> {
  const rows = await db
    .select({ id: memories.id, kind: memories.kind, content: memories.content, userId: memories.userId, status: memories.status })
    .from(memories)
    .where(eq(memories.id, memoryId))
    .limit(1);
  const row = rows[0];
  if (!row || row.userId !== userId || row.status !== "active") {
    throw new TRPCError({ code: "NOT_FOUND", message: "memory not found" });
  }
  return { id: row.id, kind: row.kind, content: row.content };
}

/**
 * The "what my sidekick knows" read model (user-memory.md §7): active memories as
 * plain sentences, ordered by kind then age, each tagged with how it was learned
 * ("you told me" vs "i picked this up"). Because memories *are* sentences, this
 * is a straight render — no translation layer.
 */
export async function listMemories(db: Database, userId: string): Promise<MemoryListItem[]> {
  return db
    .select({
      id: memories.id,
      kind: memories.kind,
      content: memories.content,
      confidence: memories.confidence,
      source: memories.source,
      eventDate: memories.eventDate,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.status, "active")))
    .orderBy(asc(memories.kind), asc(memories.createdAt));
}

/**
 * Delete a memory (user-memory.md §7): tombstone it (`status='deleted'`) and add
 * its content to `memory_suppressions` so the extractor never re-learns it.
 */
export async function forgetMemory(
  db: Database,
  userId: string,
  memoryId: string,
): Promise<{ ok: true }> {
  const memory = await ownedActiveMemory(db, userId, memoryId);
  await db.update(memories).set({ status: "deleted" }).where(eq(memories.id, memory.id));
  await db.insert(memorySuppressions).values({ userId, content: memory.content });
  await bumpMemoryVersion(db, userId);
  return { ok: true };
}

/**
 * Edit a memory (user-memory.md §7) as a user-sourced supersession: a new
 * `source='user_edit'`, `confidence='stated'` row that outranks everything, with
 * the old row flipped to `superseded` so the chain stays auditable.
 */
export async function editMemory(
  db: Database,
  userId: string,
  memoryId: string,
  content: string,
): Promise<{ id: string }> {
  const memory = await ownedActiveMemory(db, userId, memoryId);
  const inserted = await db
    .insert(memories)
    .values({
      userId,
      kind: kindOf(memory.kind),
      content,
      confidence: "stated",
      supersedesId: memory.id,
      source: "user_edit",
    })
    .returning({ id: memories.id });
  await db.update(memories).set({ status: "superseded" }).where(eq(memories.id, memory.id));
  await bumpMemoryVersion(db, userId);
  const row = inserted[0];
  if (!row) {
    throw new Error("failed to edit memory");
  }
  return { id: row.id };
}

type MemoryKindColumn = (typeof memories.kind.enumValues)[number];

function kindOf(value: string): MemoryKindColumn {
  const match = memories.kind.enumValues.find((k) => k === value);
  if (!match) {
    throw new Error(`unknown memory kind: ${value}`);
  }
  return match;
}
