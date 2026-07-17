import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { guidedSessions, userCosmetics, users } from "@sidekick/db";
import { MILESTONES } from "@sidekick/core";
import { protectedProcedure, router } from "../trpc";
import { dailyBoxStatus } from "../rewards/daily-box";

/**
 * The two jsonb columns are server-written through validated inputs, so these
 * parses normally succeed; `catch(null)` keeps a corrupt row from bricking the
 * cold-start query the whole app boots on.
 */
const skinSchema = z.object({ body: z.string(), shadow: z.string() }).nullable().catch(null);
const astralSchema = z
  .object({ archetype: z.string(), reading: z.string(), traits: z.array(z.string()) })
  .nullable()
  .catch(null);

/**
 * The one cold-start snapshot (plan 20 decision 11): every progression slice
 * the app needs at launch, stamped with `users.stateVersion` for the client's
 * compare-before-patch cache rule. Deliberately NOT here: raw session answers
 * and extracted fields/notes (sensitive — `sessions.profile` serves the star
 * chat), and goals (`goals.list` already exists). The streak slice carries the
 * full milestone ladder because StreakModal renders the whole schedule.
 */
export const stateRouter = router({
  snapshot: protectedProcedure.query(async ({ ctx }) => {
    const { db, userId } = ctx;
    const rows = await db
      .select({
        stateVersion: users.stateVersion,
        coins: users.coins,
        bond: users.bond,
        streakCount: users.streakCount,
        skin: users.skin,
        astral: users.astral,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const user = rows[0];
    if (!user) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
    }

    const box = await dailyBoxStatus(db, userId);
    const inventory = await db
      .select({
        itemKey: userCosmetics.itemKey,
        slot: userCosmetics.slot,
        equipped: userCosmetics.equipped,
        source: userCosmetics.source,
      })
      .from(userCosmetics)
      .where(eq(userCosmetics.userId, userId));
    const sessions = await db
      .select({
        sessionId: guidedSessions.sessionId,
        beat: guidedSessions.beat,
        done: guidedSessions.done,
      })
      .from(guidedSessions)
      .where(eq(guidedSessions.userId, userId));

    return {
      stateVersion: user.stateVersion,
      coins: user.coins,
      bond: user.bond,
      streak: { count: user.streakCount, milestoneLadder: MILESTONES },
      dailyBox: { claimable: box.claimable, tier: box.tier },
      inventory,
      skin: skinSchema.parse(user.skin),
      astral: astralSchema.parse(user.astral),
      sessions,
    };
  }),
});
