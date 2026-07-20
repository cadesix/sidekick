import * as Sentry from "@sentry/node";

/**
 * Error reporting for `sans-software/sidekick-server`. Must be imported before
 * anything else in the entrypoint so Sentry's instrumentation wraps the modules it
 * patches — which is also why this reads `process.env` directly instead of going
 * through `readEnv`, whose own import graph would load too early to be wrapped.
 *
 * Reads the DSN from env and stays fully disabled when unset, so a local run needs
 * no DSN and never pollutes the production issue stream.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "development",
  release: process.env.RAILWAY_GIT_COMMIT_SHA,
  sendDefaultPii: false,
});
