import { afterAll, beforeAll, expect, test } from "vitest";
import { type Database } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { buildContextView, renderSystem } from "@sidekick/shared";
import { createConversation, createUser } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

test("capability guidance is appended after persona, only for enabled capabilities", async () => {
  const userId = await createUser(db);
  const conversationId = await createConversation(db, userId);

  const all = await buildContextView(db, conversationId, {});
  const allText = renderSystem(all.system);
  expect(allText).toContain("Goal check-ins:");
  expect(allText).toContain("Reminders:");
  expect(allText).toContain("Attachments:");
  expect(allText).toContain("Apple Health summaries:");
  expect(allText).toContain("never call missing data a zero");
  // Guidance sits after the persona block, inside the static/cacheable region.
  const personaText = all.system.find((b) => b.id === "persona")?.text ?? "";
  expect(allText.indexOf("Goal check-ins:")).toBeGreaterThan(allText.indexOf(personaText));

  // Disabling the attachments capability's tool drops its guidance, keeps the rest.
  const disabled = await buildContextView(db, conversationId, { flags: { read_attachment: false } });
  const disabledText = renderSystem(disabled.system);
  expect(disabledText).not.toContain("Attachments:");
  expect(disabledText).toContain("Goal check-ins:");
  expect(disabledText).toContain("Reminders:");

  const healthDisabled = await buildContextView(db, conversationId, {
    flags: { health_summary: false },
  });
  expect(renderSystem(healthDisabled.system)).not.toContain("Apple Health summaries:");
});
