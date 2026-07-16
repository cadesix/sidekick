import { Hono } from "hono";
import type { Services } from "../context";
import { sweepCompletedCheckIns } from "./service";

/**
 * Reward-grant cron (04). A daily backstop that rolls the spinner reward for
 * every check-in a user completed today — including the front-loaded
 * streak-milestone guarantee — so a user who never opens the spinner still earns
 * their item. Idempotent, so re-running the tick grants nothing twice. Auth is
 * the `/cron/*` `CRON_SECRET` gate applied in `buildApp`.
 */
export function buildRewardsCron(services: Services): Hono {
  const app = new Hono();
  app.get("/rewards/grant", async (c) => {
    const result = await sweepCompletedCheckIns(services.db, new Date());
    return c.json(result);
  });

  return app;
}
