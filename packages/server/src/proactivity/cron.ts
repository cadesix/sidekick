import { Hono } from "hono";
import type { Services } from "../context";
import { dispatchDueProactiveTurns } from "./delivery";
import { scheduleProactiveTurns } from "./scheduler";

export function buildProactivityCron(services: Services): Hono {
  const app = new Hono();
  app.get("/proactivity/schedule", async (c) =>
    c.json(await scheduleProactiveTurns(services.db, new Date())),
  );
  app.get("/proactivity/dispatch", async (c) =>
    c.json(await dispatchDueProactiveTurns(services.db, services.model, new Date())),
  );
  return app;
}
