/** Sentry must be initialized before any other import. */
import "./instrument";

import { serve } from "@hono/node-server";
import { buildApp } from "./app";
import { startCrons } from "./cron/scheduler";
import { readEnv } from "./env";
import { logger } from "./logger";
import { createServices } from "./services";

const env = readEnv();
const app = buildApp(createServices());
const port = env.PORT ?? 8787;

const server = serve({ fetch: app.fetch, port });
logger.info({ port, environment: env.NODE_ENV }, "sidekick server listening");

/**
 * Scheduled work runs in this process (see `cron/scheduler`). It needs the same
 * bearer the HTTP callers use; without a secret the `/cron/*` gate fails closed,
 * so scheduling would only produce 401s every minute.
 */
if (env.CRON_SECRET) {
  startCrons(app, env.CRON_SECRET);
} else {
  logger.warn("CRON_SECRET is unset — scheduled jobs are disabled");
}

/**
 * An uncaught exception leaves the process in an unknown state; exit and let the
 * platform restart it rather than serve requests from a half-broken runtime.
 */
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "uncaught exception");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled rejection");
});

/**
 * Railway sends SIGTERM before replacing a container. Drain in-flight requests —
 * a chat turn can be mid-stream — but never hang the deploy on one stuck socket.
 */
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, draining connections");
  server.close(() => {
    logger.info("connections drained, exiting");
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn("drain timed out, forcing exit");
    process.exit(1);
  }, 10_000).unref();
});
