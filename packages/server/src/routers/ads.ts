import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { recordAdEvent } from "../ads/store";
import { GRAVITY_CHAT_PLACEMENT, GRAVITY_CHAT_PLACEMENT_ID } from "../ads/decision";

const adEventInput = z.object({ adUnitId: z.string() });

/**
 * The conversation window sent on dev previews: purchase-adjacent small talk so
 * Gravity has something concrete to match against and previews fill reliably.
 */
const PREVIEW_WINDOW = [
  { role: "user", content: "my running shoes are falling apart, thinking about replacing them" },
  {
    role: "assistant",
    content:
      "Sounds like it's time! Do you want something similar to what you have, or are you open to trying a different style?",
  },
  { role: "user", content: "open to anything comfortable for daily 5ks" },
];

/**
 * Ad tracking endpoints (05 §metrics). The client fires `impression` when a
 * `SponsoredCard` is ≥50% visible, `click` on tap (then opens the click url in an
 * in-app browser), and `dismiss` on the long-press "hide ads like this" sheet.
 * Each is ownership-checked and echoes back the network urls so a future
 * server-side pixel fire has them. Slotting itself is server-decided — the client
 * never requests ads (05 §client rendering).
 */
export const adsRouter = router({
  impression: protectedProcedure.input(adEventInput).mutation(({ ctx, input }) =>
    recordAdEvent(ctx.db, { userId: ctx.userId, adUnitId: input.adUnitId, type: "impression" }),
  ),

  click: protectedProcedure.input(adEventInput).mutation(({ ctx, input }) =>
    recordAdEvent(ctx.db, { userId: ctx.userId, adUnitId: input.adUnitId, type: "click" }),
  ),

  dismiss: protectedProcedure.input(adEventInput).mutation(({ ctx, input }) =>
    recordAdEvent(ctx.db, { userId: ctx.userId, adUnitId: input.adUnitId, type: "dismiss" }),
  ),

  /**
   * Fetch one ad straight from the network for the dev-only preview screen —
   * no eligibility gates, nothing persisted, no events recorded (the returned
   * `adUnitId` is a sentinel that ownership checks reject). Exists purely so
   * card styling can be iterated against real Gravity fills.
   */
  preview: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.adNetwork) {
      return null;
    }
    const ad = await ctx.adNetwork.requestAd({
      messages: PREVIEW_WINDOW,
      sessionId: `preview-${ctx.userId}`,
      userId: ctx.userId,
      placement: GRAVITY_CHAT_PLACEMENT,
      placementId: GRAVITY_CHAT_PLACEMENT_ID,
      relevancy: 0,
      excludedTopics: [],
      device: ctx.device,
    });
    if (!ad) {
      return null;
    }
    return {
      adUnitId: "preview",
      brandName: ad.brandName,
      faviconUrl: ad.favicon ?? null,
      title: ad.title,
      body: ad.adText,
      cta: ad.cta,
      clickUrl: ad.clickUrl,
    };
  }),
});
