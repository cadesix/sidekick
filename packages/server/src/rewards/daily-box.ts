import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { type Database, ledger, userCosmetics, users } from "@sidekick/db";
import { addDays, localDate } from "@sidekick/shared";
import { type BoxTier, type Milestone, MILESTONES, boxTier, rollDailyBox } from "@sidekick/core";
import { catalogProduct, grantReward } from "./service";
import { touchStreak } from "./streak";

/**
 * Minimum elapsed time between claims — the timezone-hop defense (plan 20
 * decision 6). `users.timezone` is client-influenced, so hopping zones can
 * manufacture a new local date; requiring ≥ 20h since the previous claim's
 * persisted UTC instant means a hop can never mint an extra box.
 */
const MIN_CLAIM_GAP_MS = 20 * 60 * 60 * 1000;

const milestoneSchema = z.object({
  day: z.number(),
  label: z.string(),
  coins: z.number().optional(),
  render: z.string().optional(),
});

/**
 * The full awarded payload, persisted in the claim's ledger `meta` and replayed
 * verbatim on an idempotent re-claim — the client always animates exactly what
 * was granted, never a recompute against drifted state.
 */
export const boxContentsSchema = z.object({
  date: z.string(),
  tier: z.enum(["base", "silver", "gold"]),
  /** The guaranteed seeded roll (pre-double). */
  coins: z.number(),
  doubled: z.boolean(),
  milestone: milestoneSchema.nullable(),
  /** Milestone item added to the wardrobe, null when none or converted. */
  itemGranted: z.string().nullable(),
  /** Coins a milestone-item dupe converted to (its catalog price), else 0. */
  convertedCoins: z.number(),
  /** Coins actually credited by this claim's ledger row. */
  totalCoins: z.number(),
  /** UTC claim instant — the 20h guard measures from here. */
  claimedAt: z.string(),
});
export type BoxContents = z.infer<typeof boxContentsSchema>;

function parseContents(meta: unknown): BoxContents {
  const parsed = boxContentsSchema.safeParse(meta);
  if (!parsed.success) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "corrupt box claim" });
  }
  return parsed.data;
}

async function claimByDedupeKey(
  db: Database,
  userId: string,
  dedupeKey: string,
): Promise<BoxContents | null> {
  const rows = await db
    .select({ meta: ledger.meta })
    .from(ledger)
    .where(and(eq(ledger.userId, userId), eq(ledger.dedupeKey, dedupeKey)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return parseContents(row.meta);
}

/** The most recent claim, whatever its local date — the 20h guard's anchor. */
async function latestClaim(db: Database, userId: string): Promise<BoxContents | null> {
  const rows = await db
    .select({ meta: ledger.meta })
    .from(ledger)
    .where(and(eq(ledger.userId, userId), eq(ledger.source, "daily-box")))
    .orderBy(desc(ledger.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return parseContents(row.meta);
}

function gapPasses(last: BoxContents | null, now: Date): boolean {
  if (!last) return true;
  return now.getTime() - Date.parse(last.claimedAt) >= MIN_CLAIM_GAP_MS;
}

/**
 * The streak count as-if-touched today — the UI touches then previews, so tier
 * and milestone previews must reflect the count a claim (which touches in the
 * same transaction) would actually use, not the cold column.
 */
function streakAsTouched(count: number, lastDay: string | null, today: string): number {
  if (lastDay === today) return count;
  if (lastDay === addDays(today, -1)) return count + 1;
  return 1;
}

export type DailyBoxStatus = {
  claimable: boolean;
  tier: BoxTier;
  milestone: Milestone | null;
};

/** Today's box, previewed: claimable + the tier/milestone a claim would grant. */
export async function dailyBoxStatus(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<DailyBoxStatus> {
  const rows = await db
    .select({
      timezone: users.timezone,
      streakCount: users.streakCount,
      streakLastDay: users.streakLastDay,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = rows[0];
  if (!user) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
  }
  const today = localDate(user.timezone, now);
  const streak = streakAsTouched(user.streakCount, user.streakLastDay, today);
  const claimedToday = await claimByDedupeKey(db, userId, `daily-box:${today}`);
  const last = await latestClaim(db, userId);
  return {
    claimable: !claimedToday && gapPasses(last, now),
    tier: boxTier(streak),
    milestone: MILESTONES.find((m) => m.day === streak) ?? null,
  };
}

export type BoxClaim = {
  stateVersion: number;
  /** Coin balance after the claim. */
  coins: number;
  /** Streak count after the touch this claim performed. */
  streak: number;
  /** False on an idempotent replay — `box` is the originally persisted payload. */
  granted: boolean;
  box: BoxContents;
};

/**
 * Claim today's box (plan 20 §dailyBox). One transaction: touch the streak
 * first (the tier must come from the just-touched count), roll via core's
 * seeded `rollDailyBox(streak, date)` — the exact seeding the client previews
 * with — then grant through the ledger with dedupe `daily-box:<date>` and the
 * full contents persisted in `meta`. A milestone item already owned converts
 * to its catalog price in coins (token-economy dupe protection). Re-claiming
 * the same day replays the persisted contents without a second grant; a claim
 * less than 20h after the previous one rejects (and rolls the touch back).
 */
export async function claimDailyBox(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<BoxClaim> {
  return db.transaction(async (tx) => {
    const streak = await touchStreak(tx, userId, now);
    const rows = await tx
      .select({ timezone: users.timezone, coins: users.coins })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const user = rows[0];
    if (!user) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
    }
    const today = localDate(user.timezone, now);
    const dedupeKey = `daily-box:${today}`;

    const replayed = await claimByDedupeKey(tx, userId, dedupeKey);
    if (replayed) {
      return {
        stateVersion: streak.stateVersion,
        coins: user.coins,
        streak: streak.count,
        granted: false,
        box: replayed,
      };
    }

    const last = await latestClaim(tx, userId);
    if (!gapPasses(last, now)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "the next box isn't ready yet" });
    }

    const reward = rollDailyBox(streak.count, today);
    let itemGranted: string | null = null;
    let convertedCoins = 0;
    const render = reward.milestone?.render;
    if (render) {
      const owned = await tx
        .select({ id: userCosmetics.id })
        .from(userCosmetics)
        .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, render)))
        .limit(1);
      if (owned[0]) {
        convertedCoins = catalogProduct(render).cost;
      } else {
        itemGranted = render;
      }
    }
    const box: BoxContents = {
      date: today,
      tier: reward.tier,
      coins: reward.coins,
      doubled: reward.doubled,
      milestone: reward.milestone ?? null,
      itemGranted,
      convertedCoins,
      totalCoins: reward.total + convertedCoins,
      claimedAt: now.toISOString(),
    };

    const grant = await grantReward(tx, {
      userId,
      source: "daily-box",
      dedupeKey,
      outcome: { kind: "coins", amount: box.totalCoins },
      meta: box,
    });
    if (!grant.granted) {
      return {
        stateVersion: grant.stateVersion,
        coins: grant.coins,
        streak: streak.count,
        granted: false,
        box: parseContents(grant.entry.meta),
      };
    }
    if (itemGranted) {
      await tx
        .insert(userCosmetics)
        .values({
          userId,
          itemKey: itemGranted,
          slot: catalogProduct(itemGranted).slot,
          source: "reward",
        })
        .onConflictDoNothing({ target: [userCosmetics.userId, userCosmetics.itemKey] });
    }
    return {
      stateVersion: grant.stateVersion,
      coins: grant.coins,
      streak: streak.count,
      granted: true,
      box,
    };
  });
}
