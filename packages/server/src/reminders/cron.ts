import { Hono } from "hono";
import type { Services } from "../context";
import { fireDueReminders, recomputeTimezoneDrift, type ReminderDeps } from "./engine";

/**
 * Vercel-cron-shaped endpoints for reminders (10 §delivery). `/reminders/fire`
 * runs per minute — the Vercel cron floor — firing every due reminder; the
 * claim-first delivery makes a re-run within the same minute a no-op.
 * `/reminders/recompute` is the nightly tz-drift job. A `CRON_SECRET` gate
 * (when set) protects both; unset leaves them open for local/preview.
 */
export function buildRemindersCron(services: Services): Hono {
  const app = new Hono();
  const deps: ReminderDeps = {
    db: services.db,
    model: services.model,
    expoAccessToken: process.env.EXPO_ACCESS_TOKEN,
  };
  const secret = process.env.CRON_SECRET;

  app.use("*", async (c, next) => {
    if (secret && c.req.header("authorization") !== `Bearer ${secret}`) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return next();
  });

  app.get("/reminders/fire", async (c) => {
    const result = await fireDueReminders(deps, new Date());
    return c.json(result);
  });

  app.get("/reminders/recompute", async (c) => {
    const result = await recomputeTimezoneDrift(deps.db, new Date());
    return c.json(result);
  });

  return app;
}
