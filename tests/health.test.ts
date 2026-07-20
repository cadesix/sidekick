import { afterAll, beforeAll, expect, test } from "vitest";
import type { Database } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import { type Services, buildApp } from "@sidekick/server";
import { textModel, testStorage } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

function servicesFor(database: Database): Services {
  return {
    db: database,
    model: textModel("ok"),
    flags: {},
    scheduleBackground: () => {},
    storage: testStorage(),
    captionModel: textModel("ok"),
    sessionModel: textModel("ok"),
    adNetwork: null,
    authEmail: { sendOtp: async () => {} },
    sms: { sendCode: async () => {}, verifyCode: async () => false },
  };
}

test("health reports ok and the build it is running, without requiring auth", async () => {
  const app = buildApp(servicesFor(db));
  const response = await app.request("/health");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    status: "ok",
    commit: "unknown",
    deployment: "local",
    environment: "test",
  });
});

/**
 * The reason it is a readiness probe and not just a liveness one: a process that
 * boots fine but can't reach Postgres must not be routed traffic. Closing the
 * PGlite instance is a real unreachable database, not a stubbed failure.
 */
test("health reports unavailable when the database cannot be reached", async () => {
  const { db: doomed, close: closeDoomed } = await createTestDb();
  await closeDoomed();

  const response = await buildApp(servicesFor(doomed)).request("/health");
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ status: "unavailable" });
});

test("every response carries a request id, echoing the caller's when supplied", async () => {
  const app = buildApp(servicesFor(db));
  expect((await app.request("/health")).headers.get("x-request-id")).toBeTruthy();

  const traced = await app.request("/health", { headers: { "x-request-id": "abc-123" } });
  expect(traced.headers.get("x-request-id")).toBe("abc-123");
});
