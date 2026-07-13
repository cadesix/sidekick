import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, focusSettings } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { focusMirrorPatch } from "@sidekick/shared";
import { registerDevice } from "@sidekick/server";
import { textModel, makeCaller } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

async function focusCaller(deviceId: string) {
  const { userId } = await registerDevice(db, { deviceId });
  return { userId, caller: makeCaller(db, textModel("ok"), userId) };
}

test("focus.get defaults to a disabled, empty mirror before any op", async () => {
  const { caller } = await focusCaller("focus-default");
  const view = await caller.focus.get();
  expect(view).toMatchObject({ enabled: false, budgetMinutes: null, selectionCount: 0 });
});

test("focus_set_budget mirror: enables and stores the budget", async () => {
  const { userId, caller } = await focusCaller("focus-budget");
  const view = await caller.focus.update(focusMirrorPatch.setBudget(30));
  expect(view).toMatchObject({ enabled: true, budgetMinutes: 30 });

  const rows = await db.select().from(focusSettings).where(eq(focusSettings.userId, userId));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.enabled).toBe(true);
  expect(rows[0]?.budgetMinutes).toBe(30);
});

test("start-guarding mirror carries the selection count (never app identity)", async () => {
  const { caller } = await focusCaller("focus-setup");
  const view = await caller.focus.update(
    focusMirrorPatch.startGuarding({ selectionCount: 7, budgetMinutes: 45 }),
  );
  expect(view).toMatchObject({ enabled: true, selectionCount: 7, budgetMinutes: 45 });
});

test("focus_block_now enables without needing a budget", async () => {
  const { caller } = await focusCaller("focus-block");
  const view = await caller.focus.update(focusMirrorPatch.blockNow());
  expect(view.enabled).toBe(true);
  expect(view.budgetMinutes).toBeNull();
});

test("focus_disable flips off but preserves the remembered budget + count", async () => {
  const { caller } = await focusCaller("focus-disable");
  await caller.focus.update(focusMirrorPatch.startGuarding({ selectionCount: 5, budgetMinutes: 60 }));

  const disabled = await caller.focus.update(focusMirrorPatch.disable());
  expect(disabled.enabled).toBe(false);
  // Budget/count survive so a later re-enable restores their setup.
  expect(disabled.budgetMinutes).toBe(60);
  expect(disabled.selectionCount).toBe(5);
});

test("focus_unblock and focus_open_setup leave the mirror untouched (device-only ops)", async () => {
  const { caller } = await focusCaller("focus-passthru");
  await caller.focus.update(focusMirrorPatch.setBudget(30));
  const before = await caller.focus.get();
  // Neither tool posts a mirror patch; the server view is unchanged between them.
  const after = await caller.focus.get();
  expect(after).toEqual(before);
  expect(after).toMatchObject({ enabled: true, budgetMinutes: 30 });
});

test("partial updates only touch the fields sent", async () => {
  const { caller } = await focusCaller("focus-partial");
  await caller.focus.update(focusMirrorPatch.startGuarding({ selectionCount: 3, budgetMinutes: 15 }));
  // A budget-only change must not reset the selection count.
  const view = await caller.focus.update({ budgetMinutes: 45 });
  expect(view.budgetMinutes).toBe(45);
  expect(view.selectionCount).toBe(3);
  expect(view.enabled).toBe(true);
});
