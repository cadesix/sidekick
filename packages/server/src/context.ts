import type { Database } from "@sidekick/db";
import type { FeatureFlags } from "@sidekick/shared";
import type { LanguageModel, TranscriptionModel } from "ai";
import { resolveUserId } from "./auth";
import type { AdDeviceSignals, AdNetworkClient } from "./ads/gravity";
import type { Storage } from "./storage";

/**
 * Runs a fire-and-forget task outside the request/response path — the seam the
 * post-turn safety valve (08 §triggers) uses to kick off idle work without
 * blocking the reply. Production wires this to the platform's background primitive
 * (e.g. Vercel `waitUntil`); tests inject a collector to await it deterministically.
 */
export type BackgroundScheduler = (task: () => Promise<unknown>) => void;

/** Process-wide services, built once from env (or injected in tests). */
export type Services = {
  db: Database;
  model: LanguageModel;
  flags: FeatureFlags;
  scheduleBackground: BackgroundScheduler;
  /** Attachment object store (09). */
  storage: Storage;
  /** Cheap vision/text model for image captions + file summaries (09 §ingest). */
  captionModel: LanguageModel;
  /** Audio transcription model; absent when unconfigured (09 §audio). */
  transcriptionModel?: TranscriptionModel;
  /** Ad network (05); null until a Gravity key is configured — ads off. */
  adNetwork: AdNetworkClient | null;
};

/** Per-request tRPC context. `userId` is null until the caller is authenticated. */
export type AppContext = Services & {
  userId: string | null;
  installationId?: string;
  /** Real client device signals from the request headers, for ad requests (05). */
  device?: AdDeviceSignals;
};

function parseBearer(authorization: string | null): string | null {
  if (!authorization) {
    return null;
  }
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) {
    return null;
  }
  return authorization.slice(prefix.length);
}

export async function createRequestContext(
  services: Services,
  authorization: string | null,
  device?: AdDeviceSignals,
  installationId?: string,
): Promise<AppContext> {
  const userId = await resolveUserId(services.db, parseBearer(authorization));
  return { ...services, userId, device, installationId };
}
