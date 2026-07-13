import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { type Database, adEvents, ads, messages } from "@sidekick/db";
import { estimateTokens } from "@sidekick/shared";
import type { SponsoredAd } from "./gravity";

/** The render payload the client draws a `SponsoredCard` from (05 / 07 §8). */
export type AdView = {
  adUnitId: string;
  brandName: string;
  faviconUrl: string | null;
  title: string;
  body: string;
  cta: string;
  clickUrl: string;
};

function toView(row: typeof ads.$inferSelect): AdView {
  return {
    adUnitId: row.id,
    brandName: row.brandName,
    faviconUrl: row.faviconUrl,
    title: row.title,
    body: row.body,
    cta: row.cta,
    clickUrl: row.clickUrl,
  };
}

/**
 * Persist a filled ad as an assistant-adjacent message row whose `adUnitId` marks
 * it out of the LLM view (structural guarantee — tailMessages filters `adUnitId`),
 * plus the `ads` row carrying the render payload and linkage. The message id is
 * the ad's `id` so `adUnitId === ads.id`, giving history a clean join.
 */
export async function serveAd(
  db: Database,
  input: {
    userId: string;
    conversationId: string;
    turnMessageId: number;
    network: string;
    ad: SponsoredAd;
    placement: string;
  },
): Promise<{ adUnitId: string; messageId: number }> {
  const adUnitId = randomUUID();
  const inserted = await db
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      role: "assistant",
      content: input.ad.title,
      tokenEstimate: estimateTokens(input.ad.title),
      adUnitId,
    })
    .returning({ id: messages.id });
  const messageId = inserted[0]?.id;
  if (messageId === undefined) {
    throw new Error("failed to persist ad message");
  }
  await db.insert(ads).values({
    id: adUnitId,
    userId: input.userId,
    conversationId: input.conversationId,
    messageId,
    turnMessageId: input.turnMessageId,
    network: input.network,
    externalId: input.ad.id,
    brandName: input.ad.brandName,
    faviconUrl: input.ad.favicon ?? null,
    title: input.ad.title,
    body: input.ad.adText,
    cta: input.ad.cta,
    clickUrl: input.ad.clickUrl,
    impressionUrl: input.ad.impUrl ?? null,
    placement: input.placement,
  });
  return { adUnitId, messageId };
}

/** Render payloads for a page of message ids, keyed by message id (for history). */
export async function adsForMessages(
  db: Database,
  messageIds: number[],
): Promise<Map<number, AdView>> {
  if (messageIds.length === 0) {
    return new Map();
  }
  const rows = await db.select().from(ads).where(inArray(ads.messageId, messageIds));
  const byMessage = new Map<number, AdView>();
  for (const row of rows) {
    if (row.messageId !== null) {
      byMessage.set(row.messageId, toView(row));
    }
  }
  return byMessage;
}

/**
 * Log an ad lifecycle event for a user's own ad (05 §metrics): `impression`
 * (≥50% visible), `click`, `dismiss`. Ownership-checked so one user can't write
 * events against another's ad. Returns the ad's network payload (impression /
 * click urls) so the caller can fire the network pixel where one exists.
 */
export async function recordAdEvent(
  db: Database,
  input: { userId: string; adUnitId: string; type: "impression" | "click" | "dismiss" },
): Promise<{ ok: boolean; impressionUrl: string | null; clickUrl: string | null }> {
  const rows = await db
    .select({ impressionUrl: ads.impressionUrl, clickUrl: ads.clickUrl })
    .from(ads)
    .where(and(eq(ads.id, input.adUnitId), eq(ads.userId, input.userId)))
    .limit(1);
  const ad = rows[0];
  if (!ad) {
    return { ok: false, impressionUrl: null, clickUrl: null };
  }
  await db.insert(adEvents).values({ adId: input.adUnitId, userId: input.userId, type: input.type });
  return { ok: true, impressionUrl: ad.impressionUrl, clickUrl: ad.clickUrl };
}
