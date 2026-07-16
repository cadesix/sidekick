import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@sidekick/db";
import { ianaTimezone } from "@sidekick/shared";
import { protectedProcedure, router } from "../trpc";
import { recomputeTimezoneDrift } from "../reminders/engine";

/**
 * Location surface (12). The app reverse-geocodes a coarse foreground fix on-device
 * and posts only city-level fields — coordinates are discarded before they ever
 * reach us. A timezone change (travel) refreezes reminders so a 7:30am reminder
 * stays 7:30am, via the reminders engine's own recompute helper.
 */
export const locationRouter = router({
  update: protectedProcedure
    .input(
      z.object({
        city: z.string().min(1),
        region: z.string().optional(),
        country: z.string().optional(),
        timezone: ianaTimezone.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { db, userId } = ctx;
      const now = new Date();

      const current = await db
        .select({ timezone: users.timezone })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const timezoneChanged = Boolean(input.timezone) && input.timezone !== current[0]?.timezone;

      await db
        .update(users)
        .set({
          lastCity: input.city,
          lastRegion: input.region ?? null,
          lastCountry: input.country ?? null,
          lastLocatedAt: now,
          timezone: input.timezone ?? current[0]?.timezone ?? "America/New_York",
          updatedAt: now,
        })
        .where(eq(users.id, userId));

      if (timezoneChanged) {
        await recomputeTimezoneDrift(db, now);
      }
      return { ok: true as const, timezoneChanged };
    }),

  status: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ city: users.lastCity, lastLocatedAt: users.lastLocatedAt })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);
    const row = rows[0];
    return { connected: Boolean(row?.lastLocatedAt), city: row?.city ?? null, lastLocatedAt: row?.lastLocatedAt ?? null };
  }),

  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(users)
      .set({
        lastCity: null,
        lastRegion: null,
        lastCountry: null,
        lastLocatedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, ctx.userId));
    return { ok: true as const };
  }),
});
