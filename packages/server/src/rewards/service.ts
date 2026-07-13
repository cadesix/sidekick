import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  type Database,
  actionItems,
  checkIns,
  goals,
  progressEvents,
  rewards,
  userCosmetics,
  users,
} from "@sidekick/db";
import {
  type GrantOutcome,
  type Rng,
  REDEEM_COST,
  currentStreak,
  getCosmetic,
  localDate,
  rollReward,
  starterCosmetics,
} from "@sidekick/shared";

type RewardRow = typeof rewards.$inferSelect;

export type GrantResult = {
  reward: RewardRow;
  /** False when the `dedupeKey` already existed — the grant was a no-op. */
  granted: boolean;
  /** True when an item was newly added to the wardrobe (not a dupe). */
  addedToInventory: boolean;
};

/**
 * THE generic reward grant path (04). Every reward source — streak milestones,
 * the daily spinner, and later deep-talk `source:'event'` bonuses — flows through
 * here. Idempotent on `(userId, dedupeKey)`: a re-run returns the existing grant
 * without a second item or sparks bump. The deep-talks engineer calls this with
 * `source:'event'` and a per-session `dedupeKey`.
 */
export async function grantReward(
  db: Database,
  input: { userId: string; source: string; dedupeKey: string; outcome: GrantOutcome },
): Promise<GrantResult> {
  const { userId, source, dedupeKey, outcome } = input;
  const values =
    outcome.kind === "item"
      ? { userId, source, dedupeKey, kind: "item" as const, itemKey: outcome.itemKey }
      : { userId, source, dedupeKey, kind: "sparks" as const, sparks: outcome.amount };

  const inserted = await db
    .insert(rewards)
    .values(values)
    .onConflictDoNothing({ target: [rewards.userId, rewards.dedupeKey] })
    .returning();
  const reward = inserted[0];

  if (!reward) {
    const existing = await db
      .select()
      .from(rewards)
      .where(and(eq(rewards.userId, userId), eq(rewards.dedupeKey, dedupeKey)))
      .limit(1);
    const row = existing[0];
    if (!row) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "reward grant lost" });
    }
    return { reward: row, granted: false, addedToInventory: false };
  }

  if (outcome.kind === "sparks") {
    await db
      .update(users)
      .set({ sparks: sql`${users.sparks} + ${outcome.amount}` })
      .where(eq(users.id, userId));
    return { reward, granted: true, addedToInventory: false };
  }

  const definition = getCosmetic(outcome.itemKey);
  if (!definition) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `unknown cosmetic ${outcome.itemKey}` });
  }
  const ownedInsert = await db
    .insert(userCosmetics)
    .values({ userId, itemKey: definition.key, slot: definition.slot })
    .onConflictDoNothing({ target: [userCosmetics.userId, userCosmetics.itemKey] })
    .returning({ id: userCosmetics.id });

  return { reward, granted: true, addedToInventory: ownedInsert.length > 0 };
}

/** Grant every starter cosmetic (idempotently). Safe to call on any read path. */
export async function ensureStarterCosmetics(db: Database, userId: string): Promise<void> {
  const starters = starterCosmetics();
  if (starters.length === 0) {
    return;
  }
  await db
    .insert(userCosmetics)
    .values(starters.map((c) => ({ userId, itemKey: c.key, slot: c.slot, equipped: false })))
    .onConflictDoNothing({ target: [userCosmetics.userId, userCosmetics.itemKey] });
}

/** The user's overall check-in streak on their local `today` (mirrors goals.list). */
export async function userStreak(db: Database, userId: string, today: string): Promise<number> {
  const hitRows = await db
    .select({ date: progressEvents.date })
    .from(progressEvents)
    .innerJoin(actionItems, eq(progressEvents.actionItemId, actionItems.id))
    .innerJoin(goals, eq(actionItems.goalId, goals.id))
    .where(and(eq(goals.userId, userId), inArray(progressEvents.outcome, ["hit", "partial"])));
  return currentStreak(
    hitRows.map((r) => r.date),
    today,
  );
}

async function ownedKeys(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ itemKey: userCosmetics.itemKey })
    .from(userCosmetics)
    .where(eq(userCosmetics.userId, userId));
  return rows.map((r) => r.itemKey);
}

/**
 * Roll and grant the daily-spinner reward for one completed check-in (04). The
 * grant is keyed to the check-in, so re-calling (client re-open, cron sweep)
 * returns the same already-granted result and never re-rolls — the §6 idempotency
 * contract. Returns the reward plus whether this call is the one that revealed it.
 */
export async function spinForCheckIn(
  db: Database,
  input: { userId: string; checkInId: string; today: string; rng?: Rng },
): Promise<GrantResult> {
  const [streak, keys] = await Promise.all([
    userStreak(db, input.userId, input.today),
    ownedKeys(db, input.userId),
  ]);
  const outcome = rollReward({ streak, ownedKeys: keys, rng: input.rng });
  return grantReward(db, {
    userId: input.userId,
    source: "spinner",
    dedupeKey: `spin:${input.checkInId}`,
    outcome,
  });
}

/** Mark a reward's animation as seen so the spinner never re-presents it. */
export async function markRewardRevealed(db: Database, rewardId: string): Promise<void> {
  await db
    .update(rewards)
    .set({ revealedAt: new Date() })
    .where(and(eq(rewards.id, rewardId), sql`${rewards.revealedAt} is null`));
}

export async function assertOwned(
  db: Database,
  userId: string,
  itemKey: string,
): Promise<{ slot: string }> {
  const rows = await db
    .select({ slot: userCosmetics.slot })
    .from(userCosmetics)
    .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, itemKey)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "FORBIDDEN", message: "you don't own that item" });
  }
  return row;
}

/** Equip one owned item, clearing anything else equipped in the same slot. */
export async function equipCosmetic(db: Database, userId: string, itemKey: string): Promise<void> {
  const { slot } = await assertOwned(db, userId, itemKey);
  await db
    .update(userCosmetics)
    .set({ equipped: false })
    .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.slot, slot)));
  await db
    .update(userCosmetics)
    .set({ equipped: true })
    .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, itemKey)));
}

export async function unequipCosmetic(db: Database, userId: string, itemKey: string): Promise<void> {
  await assertOwned(db, userId, itemKey);
  await db
    .update(userCosmetics)
    .set({ equipped: false })
    .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, itemKey)));
}

/**
 * Redeem sparks for a chosen cosmetic (04 pity timer — "N more to pick anything
 * you want"). Spends `REDEEM_COST` and adds the item, atomically guarded against
 * double-spend and re-owning.
 */
export async function redeemSparks(
  db: Database,
  userId: string,
  itemKey: string,
): Promise<{ sparks: number }> {
  const definition = getCosmetic(itemKey);
  if (!definition || definition.slot === "environment") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "that item can't be redeemed" });
  }
  const already = await db
    .select({ id: userCosmetics.id })
    .from(userCosmetics)
    .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, itemKey)))
    .limit(1);
  if (already[0]) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "you already own that item" });
  }

  const spent = await db
    .update(users)
    .set({ sparks: sql`${users.sparks} - ${REDEEM_COST}` })
    .where(and(eq(users.id, userId), sql`${users.sparks} >= ${REDEEM_COST}`))
    .returning({ sparks: users.sparks });
  const row = spent[0];
  if (!row) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "not enough sparks yet" });
  }
  await db
    .insert(userCosmetics)
    .values({ userId, itemKey: definition.key, slot: definition.slot })
    .onConflictDoNothing({ target: [userCosmetics.userId, userCosmetics.itemKey] });
  return { sparks: row.sparks };
}

/**
 * Backstop sweep (04 streak-evaluation cron): for every check-in completed on the
 * user's local today, ensure its spinner reward has been rolled and granted. This
 * covers users who completed a check-in but never opened the spinner, and applies
 * the front-loaded streak-milestone guarantee. Idempotent — a re-run grants
 * nothing new (dedupe on `spin:<checkInId>`).
 */
export async function sweepCompletedCheckIns(
  db: Database,
  now: Date,
): Promise<{ considered: number; granted: number }> {
  const rows = await db
    .select({ id: checkIns.id, userId: checkIns.userId, date: checkIns.date, timezone: users.timezone })
    .from(checkIns)
    .innerJoin(users, eq(checkIns.userId, users.id))
    .where(eq(checkIns.status, "completed"));
  const today = rows.filter((r) => r.date === localDate(r.timezone, now));

  let granted = 0;
  for (const row of today) {
    const result = await spinForCheckIn(db, {
      userId: row.userId,
      checkInId: row.id,
      today: row.date,
    });
    if (result.granted) {
      granted += 1;
    }
  }
  return { considered: today.length, granted };
}

export type CheckInReward = {
  status: "none" | "available" | "revealed";
  checkInId: string | null;
};

/**
 * The home screen's spinner gate: is there a reward to present for today's
 * completed check-in? `available` means the check-in is done and its spinner
 * result hasn't been animated yet (whether or not the roll has run).
 */
export async function todayRewardStatus(
  db: Database,
  userId: string,
  today: string,
): Promise<CheckInReward> {
  const checkInRows = await db
    .select({ id: checkIns.id, status: checkIns.status })
    .from(checkIns)
    .where(and(eq(checkIns.userId, userId), eq(checkIns.date, today)))
    .limit(1);
  const checkIn = checkInRows[0];
  if (!checkIn || checkIn.status !== "completed") {
    return { status: "none", checkInId: null };
  }
  const rewardRows = await db
    .select({ revealedAt: rewards.revealedAt })
    .from(rewards)
    .where(and(eq(rewards.userId, userId), eq(rewards.dedupeKey, `spin:${checkIn.id}`)))
    .limit(1);
  const reward = rewardRows[0];
  if (reward && reward.revealedAt) {
    return { status: "revealed", checkInId: checkIn.id };
  }
  return { status: "available", checkInId: checkIn.id };
}
