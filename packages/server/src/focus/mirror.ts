import { eq } from "drizzle-orm";
import { type Database, focusSettings } from "@sidekick/db";
import type { FocusMirrorInput } from "@sidekick/shared";

/**
 * The server mirror of on-device focus state (13-focus-mode.md §state model). It
 * holds ZERO app identity — only `enabled`, an optional daily `budgetMinutes`, and
 * a `selectionCount` ("7 apps", the one identity-shaped thing Apple even lets us
 * know). The app is authoritative; it posts these fields via `focus.update` after
 * a native op lands, purely so the sidekick's context and cross-device sanity have
 * something to read. There is no on-device data we could sync back even if we wanted.
 */

export type FocusSettingsView = {
  enabled: boolean;
  budgetMinutes: number | null;
  selectionCount: number;
  updatedAt: Date | null;
};

const DEFAULT_VIEW: FocusSettingsView = {
  enabled: false,
  budgetMinutes: null,
  selectionCount: 0,
  updatedAt: null,
};

export async function getFocusSettings(db: Database, userId: string): Promise<FocusSettingsView> {
  const rows = await db
    .select({
      enabled: focusSettings.enabled,
      budgetMinutes: focusSettings.budgetMinutes,
      selectionCount: focusSettings.selectionCount,
      updatedAt: focusSettings.updatedAt,
    })
    .from(focusSettings)
    .where(eq(focusSettings.userId, userId))
    .limit(1);
  return rows[0] ?? DEFAULT_VIEW;
}

/**
 * Partial upsert of the mirror. Only the fields the client sends are touched, so
 * `focus_disable` can flip `enabled` off without clearing the remembered budget or
 * app count for a later re-enable. Always bumps `updatedAt`.
 */
export async function updateFocusSettings(
  db: Database,
  userId: string,
  patch: FocusMirrorInput,
): Promise<FocusSettingsView> {
  const now = new Date();
  const current = await getFocusSettings(db, userId);
  const next = {
    userId,
    enabled: patch.enabled ?? current.enabled,
    budgetMinutes: patch.budgetMinutes === undefined ? current.budgetMinutes : patch.budgetMinutes,
    selectionCount: patch.selectionCount ?? current.selectionCount,
    updatedAt: now,
  };
  await db
    .insert(focusSettings)
    .values(next)
    .onConflictDoUpdate({
      target: focusSettings.userId,
      set: {
        enabled: next.enabled,
        budgetMinutes: next.budgetMinutes,
        selectionCount: next.selectionCount,
        updatedAt: now,
      },
    });
  return {
    enabled: next.enabled,
    budgetMinutes: next.budgetMinutes,
    selectionCount: next.selectionCount,
    updatedAt: now,
  };
}
