import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { recordAdEvent } from "../ads/store";

const adEventInput = z.object({ adUnitId: z.string() });

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
});
