import { Hono } from "hono";
import type { Services } from "../context";
import { readEnv } from "../env";
import {
  type CheckinDeps,
  closeStaleCheckins,
  followUpCheckin,
  openCheckin,
  selectDueUsers,
  selectFollowUpCandidates,
} from "./engine";

/**
 * Cron endpoints for the daily check-in engine (01: scheduled, timezone-sharded).
 * Each tick handles "users whose local reminder time is now".
 * Auth is the `/cron/*` `CRON_SECRET` gate applied in `buildApp`.
 */
export function buildCheckinCron(services: Services): Hono {
  const app = new Hono();
  const deps: CheckinDeps = {
    db: services.db,
    model: services.model,
    weatherApiKey: readEnv().WEATHER_API_KEY,
  };
  app.get("/checkins/open", async (c) => {
    const now = new Date();
    const users = await selectDueUsers(deps.db, now);
    const results = await Promise.all(users.map((user) => openCheckin(deps, user, now)));
    const created = results.filter((r) => r.created).length;
    return c.json({ due: users.length, created });
  });

  app.get("/checkins/followup", async (c) => {
    const now = new Date();
    const users = await selectFollowUpCandidates(deps.db, now);
    const results = await Promise.all(users.map((user) => followUpCheckin(deps, user, now)));
    const sent = results.filter((r) => r.sent).length;
    return c.json({ considered: users.length, sent });
  });

  app.get("/checkins/close", async (c) => {
    const { closed } = await closeStaleCheckins(deps.db, new Date());
    return c.json({ closed });
  });

  return app;
}
