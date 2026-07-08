import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { type Database, attachments, checkIns, conversationSummaries, messages } from "@sidekick/db";
import type { AttachmentKind, AttachmentStatus } from "./attachments";

export type SummaryRow = {
  id: number;
  coversToMessageId: number;
  content: string;
  tokenEstimate: number;
};

/**
 * The current rolling summary for a conversation — one indexed descending lookup
 * on `(conversationId, id desc)`. Summaries are disposable derived data (08
 * invariant 2), so "latest wins" is the only ordering that matters.
 */
export async function latestSummary(
  db: Database,
  conversationId: string,
): Promise<SummaryRow | null> {
  const rows = await db
    .select({
      id: conversationSummaries.id,
      coversToMessageId: conversationSummaries.coversToMessageId,
      content: conversationSummaries.content,
      tokenEstimate: conversationSummaries.tokenEstimate,
    })
    .from(conversationSummaries)
    .where(eq(conversationSummaries.conversationId, conversationId))
    .orderBy(desc(conversationSummaries.id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * One attachment as the LLM-view assembler sees it (09). `storageKey` becomes a
 * public URL for image/PDF parts; the derived text fields drive the windowing
 * rules. Rows are only attached to their message once the send lands.
 */
export type TailAttachment = {
  id: string;
  kind: AttachmentKind;
  mime: string;
  bytes: number;
  storageKey: string;
  caption: string | null;
  transcript: string | null;
  extractedText: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  status: AttachmentStatus;
};

export type TailMessage = {
  id: number;
  role: string;
  content: string;
  tokenEstimate: number;
  isCheckinOpener: boolean;
  /** Raw AI SDK tool-call array persisted on assistant/tool rows (08/12). */
  toolCalls: unknown;
  /** Attachments carried by this message, oldest-first (09). */
  attachments: TailAttachment[];
};

async function attachmentsForMessages(
  db: Database,
  messageIds: number[],
): Promise<Map<number, TailAttachment[]>> {
  const grouped = new Map<number, TailAttachment[]>();
  if (messageIds.length === 0) {
    return grouped;
  }
  const rows = await db
    .select({
      id: attachments.id,
      messageId: attachments.messageId,
      kind: attachments.kind,
      mime: attachments.mime,
      bytes: attachments.bytes,
      storageKey: attachments.storageKey,
      caption: attachments.caption,
      transcript: attachments.transcript,
      extractedText: attachments.extractedText,
      width: attachments.width,
      height: attachments.height,
      durationMs: attachments.durationMs,
      status: attachments.status,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .where(inArray(attachments.messageId, messageIds))
    .orderBy(asc(attachments.createdAt));
  for (const row of rows) {
    if (row.messageId === null) {
      continue;
    }
    const list = grouped.get(row.messageId) ?? [];
    list.push({
      id: row.id,
      kind: row.kind as AttachmentKind,
      mime: row.mime,
      bytes: row.bytes,
      storageKey: row.storageKey,
      caption: row.caption,
      transcript: row.transcript,
      extractedText: row.extractedText,
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
      status: row.status as AttachmentStatus,
    });
    grouped.set(row.messageId, list);
  }
  return grouped;
}

/**
 * The verbatim tail: every non-ad message newer than the summary watermark,
 * ascending. Ad messages (`adUnitId` not null) are excluded from the LLM view
 * entirely (08 §context assembly) — never in the tail, never summarized. Each
 * row is tagged with whether it is a cron check-in opener (a left join on
 * `check_ins.opener_message_id`), which the compaction boundary selector prefers
 * as a natural day seam, and carries its `toolCalls` jsonb + joined attachments
 * so the context assembler can reconstruct tool-message pairs (08/12) and apply
 * the 09 attachment view rules.
 */
export async function tailMessages(
  db: Database,
  conversationId: string,
  afterMessageId: number,
): Promise<TailMessage[]> {
  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      tokenEstimate: messages.tokenEstimate,
      toolCalls: messages.toolCalls,
      openerCheckInId: checkIns.id,
    })
    .from(messages)
    .leftJoin(checkIns, eq(checkIns.openerMessageId, messages.id))
    .where(
      and(
        eq(messages.conversationId, conversationId),
        gt(messages.id, afterMessageId),
        isNull(messages.adUnitId),
      ),
    )
    .orderBy(asc(messages.id));

  const byMessage = await attachmentsForMessages(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    tokenEstimate: row.tokenEstimate,
    isCheckinOpener: row.openerCheckInId !== null,
    toolCalls: row.toolCalls,
    attachments: byMessage.get(row.id) ?? [],
  }));
}

export function sumTokens(rows: { tokenEstimate: number }[]): number {
  return rows.reduce((total, row) => total + row.tokenEstimate, 0);
}

/**
 * Total token estimate of the current verbatim tail (non-ad messages newer than
 * the summary watermark). The post-turn safety valve (08 §triggers) compares
 * this against `TAIL_MAX_TOKENS` to force mid-session compaction. One aggregate
 * query, no rows materialized.
 */
export async function tailTokens(db: Database, conversationId: string): Promise<number> {
  const summary = await latestSummary(db, conversationId);
  const watermark = summary?.coversToMessageId ?? 0;
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${messages.tokenEstimate}), 0)` })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        gt(messages.id, watermark),
        isNull(messages.adUnitId),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}
