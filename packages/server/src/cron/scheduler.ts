import * as Sentry from "@sentry/node";
import cron from "node-cron";
import type { buildApp } from "../app";
import { logger } from "../logger";

/**
 * The scheduled work, previously declared as Vercel Cron entries in `vercel.json`.
 * Railway has no cron primitive for a web service, so — as FieldQuote does — the
 * jobs run in the API process. Schedules are unchanged from the Vercel config and
 * are pinned to UTC, which is what Vercel Cron used; the reminder and check-in
 * engines shard by the user's own timezone, so the tick's zone must stay fixed.
 */
export const CRON_JOBS: { path: string; schedule: string }[] = [
  { path: "/cron/idle", schedule: "*/15 * * * *" },
  { path: "/cron/ad-profiles", schedule: "30 8 * * *" },
  { path: "/cron/reminders/fire", schedule: "* * * * *" },
  { path: "/cron/reminders/recompute", schedule: "0 4 * * *" },
  { path: "/cron/proactivity/schedule", schedule: "*/15 * * * *" },
  { path: "/cron/proactivity/dispatch", schedule: "* * * * *" },
  { path: "/cron/notifications/send", schedule: "* * * * *" },
  { path: "/cron/notifications/receipts", schedule: "*/15 * * * *" },
];

/**
 * Drive the jobs through the app's own `/cron/*` routes rather than calling the
 * engines directly. `app.request` dispatches in-process (no socket, no DNS), so
 * this keeps one definition of each job — still reachable over HTTP for a manual
 * re-run — and still exercises the `CRON_SECRET` gate exactly as a caller would.
 */
export function startCrons(app: ReturnType<typeof buildApp>, secret: string): void {
  for (const job of CRON_JOBS) {
    cron.schedule(
      job.schedule,
      async () => {
        const startedAt = Date.now();
        try {
          const response = await app.request(job.path, {
            headers: { authorization: `Bearer ${secret}` },
          });
          const durationMs = Date.now() - startedAt;
          if (!response.ok) {
            logger.error({ path: job.path, status: response.status, durationMs }, "cron failed");
            Sentry.captureException(
              new Error(`cron ${job.path} responded ${response.status}`),
              { tags: { cron: job.path } },
            );
            return;
          }
          logger.info({ path: job.path, durationMs }, "cron completed");
        } catch (error) {
          logger.error({ err: error, path: job.path }, "cron threw");
          Sentry.captureException(error, { tags: { cron: job.path } });
        }
      },
      { timezone: "UTC" },
    );
  }
  logger.info({ jobs: CRON_JOBS.length }, "cron scheduler started");
}
