import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { type Database, messages } from "@sidekick/db";

export type AdWindowMessage = { id: number; role: string; content: string };

/**
 * The message window that MAY be forwarded to an ad partner (Gravity et al.,
 * 05 / user-memory.md §5). It is the enforcement point for plan 12's hard privacy
 * line: any message flagged `sensitive` — health-derived assistant turns and the
 * device health tool results — is dropped here, alongside ad messages (never part
 * of the conversation) and `tool` messages (raw payloads, not conversation). Every
 * path that builds context for an ad request MUST go through this, so health data
 * can never reach the ads even by accident.
 */
export async function adForwardMessages(
  db: Database,
  conversationId: string,
  limit: number,
): Promise<AdWindowMessage[]> {
  const rows = await db
    .select({ id: messages.id, role: messages.role, content: messages.content })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.sensitive, false),
        isNull(messages.adUnitId),
        inArray(messages.role, ["user", "assistant"]),
      ),
    )
    .orderBy(desc(messages.id))
    .limit(limit);
  return rows.reverse();
}

/**
 * Flag messages as `sensitive` (12 §hard privacy line). Health-derived assistant
 * messages are marked so `adForwardMessages` strips them from anything sent to an
 * ad partner. The chat pipeline calls this for a turn whose rendered context
 * carried health data.
 */
export async function markMessagesSensitive(db: Database, messageIds: number[]): Promise<void> {
  if (messageIds.length === 0) {
    return;
  }
  await db.update(messages).set({ sensitive: true }).where(inArray(messages.id, messageIds));
}
