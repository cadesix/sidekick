import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

test("the drizzle migration applies cleanly to PGlite and round-trips a row", async () => {
  const inserted = await db
    .insert(users)
    .values({ name: "Maya", ageBracket: "25-34", gender: "female" })
    .returning();
  const user = inserted[0];
  if (!user) {
    throw new Error("expected an inserted user");
  }
  expect(user.memoryVersion).toBe(1);
  expect(user.contextScore).toBe(0);
  expect(user.timezone).toBe("America/New_York");

  const found = await db.select().from(users).where(eq(users.id, user.id));
  expect(found).toHaveLength(1);
  expect(found[0]?.name).toBe("Maya");
});
