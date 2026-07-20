import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  type Database,
  actionItems,
  conversations,
  goals,
  guidedSessions,
  ledger,
  progressEvents,
  sessionFields,
  sessionNotes,
  userCosmetics,
  users,
} from "@sidekick/db";
import { BOND_MIN, sessionFor } from "@sidekick/core";
import { localDate, userTimezone } from "@sidekick/shared";
import { grantReward, spendCoins } from "../rewards/service";
import { boxContentsSchema } from "../rewards/daily-box";

// The DevPanel's levers, server-side (plan 20 §dev router). Each one preserves
// the ledger invariant `users.coins = sum(ledger.coins)` and bumps stateVersion,
// so a dev poke leaves the account in a state the real faucets/spends could also
// have produced — never a hand-set column the ledger can't explain. Every
// multi-step lever is a single transaction.

export type CoinBalance = { stateVersion: number; coins: number };

/**
 * A signed coin adjustment as a real `dev-adjust:<uuid>` ledger movement — never
 * a direct column write. A positive amount grants; a negative amount spends
 * through the guarded path, so an adjustment that would drop the balance below
 * zero rejects with BAD_REQUEST and writes nothing.
 */
export async function adjustCoins(db: Database, userId: string, amount: number): Promise<CoinBalance> {
  const dedupeKey = `dev-adjust:${randomUUID()}`;
  if (amount > 0) {
    const grant = await grantReward(db, {
      userId,
      source: "dev-adjust",
      dedupeKey,
      outcome: { kind: "coins", amount },
    });
    return { stateVersion: grant.stateVersion, coins: grant.coins };
  }
  const spend = await spendCoins(db, { userId, cost: -amount, source: "dev-adjust", dedupeKey });
  return { stateVersion: spend.stateVersion, coins: spend.coins };
}

export type BondState = { stateVersion: number; bond: number };

/** Set bond outright (10–100) — a plain column write plus the version bump. */
export async function setBond(db: Database, userId: string, bond: number): Promise<BondState> {
  const rows = await db
    .update(users)
    .set({ bond, stateVersion: sql`${users.stateVersion} + 1` })
    .where(eq(users.id, userId))
    .returning({ bond: users.bond, stateVersion: users.stateVersion });
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
  }
  return { stateVersion: row.stateVersion, bond: row.bond };
}

export type StreakState = { stateVersion: number; count: number };

/**
 * Set the app-open streak count, stamping `streakLastDay` to the user's local
 * today so the next `streak.touch` behaves naturally (a same-day no-op, then a
 * consecutive-day increment).
 */
export async function setStreak(
  db: Database,
  userId: string,
  count: number,
  now = new Date(),
): Promise<StreakState> {
  const today = localDate(await userTimezone(db, userId), now);
  const rows = await db
    .update(users)
    .set({
      streakCount: count,
      streakLastDay: today,
      stateVersion: sql`${users.stateVersion} + 1`,
    })
    .where(eq(users.id, userId))
    .returning({ count: users.streakCount, stateVersion: users.stateVersion });
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
  }
  return { stateVersion: row.stateVersion, count: row.count };
}

export type SessionReset = { stateVersion: number; coins: number; bond: number };

/**
 * Wipe guided-session progress and unwind exactly what it granted: delete the
 * `guided_sessions` rows and their `session:<id>` ledger rows, decrement
 * `users.coins` by the deleted rows' coin sum (keeping the invariant), and
 * reverse each completed session's core-catalog bond, floored at `BOND_MIN`. A
 * re-run session then pays again without double-counting. `clearProfile` also
 * drops the extracted fields/notes and the astral card — the DevPanel's
 * `resetProfile` vs progress-only `resetSessions` distinction.
 */
async function resetSessionState(
  db: Database,
  userId: string,
  clearProfile: boolean,
): Promise<SessionReset> {
  return db.transaction(async (tx) => {
    const sessions = await tx
      .select({ sessionId: guidedSessions.sessionId, done: guidedSessions.done })
      .from(guidedSessions)
      .where(eq(guidedSessions.userId, userId));
    const sessionLedger = await tx
      .select({ coins: ledger.coins })
      .from(ledger)
      .where(and(eq(ledger.userId, userId), eq(ledger.source, "session")));

    const coinSum = sessionLedger.reduce((sum, row) => sum + (row.coins ?? 0), 0);
    const bondSum = sessions
      .filter((s) => s.done)
      .reduce((sum, s) => sum + (sessionFor(s.sessionId)?.bond ?? 0), 0);

    await tx.delete(guidedSessions).where(eq(guidedSessions.userId, userId));
    await tx.delete(ledger).where(and(eq(ledger.userId, userId), eq(ledger.source, "session")));
    if (clearProfile) {
      await tx.delete(sessionFields).where(eq(sessionFields.userId, userId));
      await tx.delete(sessionNotes).where(eq(sessionNotes.userId, userId));
    }

    const update = {
      coins: sql`${users.coins} - ${coinSum}`,
      bond: sql`greatest(${BOND_MIN}, ${users.bond} - ${bondSum})`,
      stateVersion: sql`${users.stateVersion} + 1`,
      ...(clearProfile ? { astral: null } : {}),
    };
    const rows = await tx
      .update(users)
      .set(update)
      .where(eq(users.id, userId))
      .returning({ coins: users.coins, bond: users.bond, stateVersion: users.stateVersion });
    const row = rows[0];
    if (!row) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
    }
    return { stateVersion: row.stateVersion, coins: row.coins, bond: row.bond };
  });
}

/** Delete session progress only (coins/bond unwound; fields/notes/astral kept). */
export function resetSessions(db: Database, userId: string): Promise<SessionReset> {
  return resetSessionState(db, userId, false);
}

/** `resetSessions` plus the extracted profile: fields, notes, and the astral card. */
export function resetProfile(db: Database, userId: string): Promise<SessionReset> {
  return resetSessionState(db, userId, true);
}

/**
 * DEV: wipe the onboarding chat so the funnel runs fresh. Deletes the
 * `kind='onboarding'` conversation (messages cascade), the user's goals + their
 * action items and progress events (no FK cascade there), and clears the funnel
 * flags (`reminderTime`, `onboardingCompletedAt`). Lets "Replay onboarding"
 * actually re-run the guided-habit chat instead of resuming a finished one.
 */
export async function resetOnboarding(db: Database, userId: string): Promise<{ ok: true }> {
  await db.transaction(async (tx) => {
    // Retire the onboarding conversation rather than delete it (it has many
    // non-cascading children — summaries, ads, attachments…); startOnboardingChat
    // only matches kind='onboarding', so retiring it makes the funnel create a
    // fresh conversation next time.
    await tx
      .update(conversations)
      .set({ kind: "onboarding_archived" })
      .where(and(eq(conversations.userId, userId), eq(conversations.kind, "onboarding")));

    const goalRows = await tx.select({ id: goals.id }).from(goals).where(eq(goals.userId, userId));
    const goalIds = goalRows.map((g) => g.id);
    if (goalIds.length > 0) {
      const itemRows = await tx
        .select({ id: actionItems.id })
        .from(actionItems)
        .where(inArray(actionItems.goalId, goalIds));
      const itemIds = itemRows.map((i) => i.id);
      if (itemIds.length > 0) {
        await tx.delete(progressEvents).where(inArray(progressEvents.actionItemId, itemIds));
      }
      await tx.delete(actionItems).where(inArray(actionItems.goalId, goalIds));
      await tx.delete(goals).where(inArray(goals.id, goalIds));
    }

    await tx
      .update(users)
      .set({ reminderTime: null, onboardingCompletedAt: null })
      .where(eq(users.id, userId));
  });
  return { ok: true };
}

/**
 * Make today's daily box claimable again: delete today's `daily-box:<date>`
 * ledger row, decrement `users.coins` by the amount it granted (keeping the
 * invariant), and delete any milestone item the persisted `meta` says that box
 * granted. A no-op — with the version still bumped — when today's box was never
 * claimed.
 */
export async function resetDailyBox(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<CoinBalance> {
  return db.transaction(async (tx) => {
    const today = localDate(await userTimezone(tx, userId), now);
    const dedupeKey = `daily-box:${today}`;
    const rows = await tx
      .select({ coins: ledger.coins, meta: ledger.meta })
      .from(ledger)
      .where(and(eq(ledger.userId, userId), eq(ledger.dedupeKey, dedupeKey)))
      .limit(1);
    const row = rows[0];

    const parsed = row ? boxContentsSchema.safeParse(row.meta) : null;
    const itemGranted = parsed?.success ? parsed.data.itemGranted : null;

    if (row) {
      await tx.delete(ledger).where(and(eq(ledger.userId, userId), eq(ledger.dedupeKey, dedupeKey)));
      if (itemGranted) {
        await tx
          .delete(userCosmetics)
          .where(and(eq(userCosmetics.userId, userId), eq(userCosmetics.itemKey, itemGranted)));
      }
    }

    const refund = row?.coins ?? 0;
    const updated = await tx
      .update(users)
      .set({
        coins: sql`${users.coins} - ${refund}`,
        stateVersion: sql`${users.stateVersion} + 1`,
      })
      .where(eq(users.id, userId))
      .returning({ coins: users.coins, stateVersion: users.stateVersion });
    const user = updated[0];
    if (!user) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "user not found" });
    }
    return { stateVersion: user.stateVersion, coins: user.coins };
  });
}
