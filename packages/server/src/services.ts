import { createDb } from "@sidekick/db/client";
import { featureFlagsFromEnv, setAppleMusicClientResolver } from "@sidekick/shared";
import { gravityClientFromEnv } from "./ads/gravity";
import type { Services } from "./context";
import { readEnv } from "./env";
import { createModel, createTranscriptionModel } from "./model";
import { appleMusicClientForUser } from "./music/client-factory";
import { createStorage } from "./storage";

/** Wire the shared music tools to the real (token-decrypting) client resolver. */
setAppleMusicClientResolver(appleMusicClientForUser);

/**
 * The production background runner: best-effort fire-and-forget. On a serverless
 * host this should be swapped for the platform primitive (e.g. Vercel
 * `waitUntil`) so the response isn't torn down before the task runs.
 */
function fireAndForget(task: () => Promise<unknown>): void {
  void task().catch((error) => console.error("background task failed", error));
}

/** Build production services from env. Never called by tests. */
export function createServices(): Services {
  const env = readEnv();
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  const model = createModel(env);
  return {
    db: createDb(env.DATABASE_URL),
    model,
    flags: featureFlagsFromEnv(env),
    scheduleBackground: fireAndForget,
    storage: createStorage(env),
    captionModel: model,
    transcriptionModel: createTranscriptionModel(env),
    adNetwork: gravityClientFromEnv(env),
  };
}
