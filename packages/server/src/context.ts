import type { Database } from "@sidekick/db";
import type { FeatureFlags } from "@sidekick/shared";
import type { LanguageModel, TranscriptionModel } from "ai";
import type { AuthEmailSender } from "./auth/email";
import { getSessionFromAuthHeader } from "./auth/sessions";
import type { SmsSender } from "./auth/sms";
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
  /** Guided-session acks + extraction (plan 20 decision 9) — the client's old direct-OpenAI calls. */
  sessionModel: LanguageModel;
  /** Ad network (05); null until a Gravity key is configured — ads off. */
  adNetwork: AdNetworkClient | null;
  /** Email OTP delivery (19-auth.md); Resend in prod, console.log in dev. */
  authEmail: AuthEmailSender;
  /** SMS OTP send/verify (19-auth.md); Twilio Verify, throws if unconfigured. */
  sms: SmsSender;
};

/** Per-request tRPC context. `userId` is null until the caller is authenticated. */
export type AppContext = Services & {
  userId: string | null;
  /** The resolved session's id — carried so `auth.logout` can revoke it. */
  sessionId: string | null;
  installationId?: string;
  /** Real client device signals from the request headers, for ad requests (05). */
  device?: AdDeviceSignals;
};

export async function createRequestContext(
  services: Services,
  authorization: string | null,
  device?: AdDeviceSignals,
  installationId?: string,
): Promise<AppContext> {
  const session = await getSessionFromAuthHeader(services.db, authorization);
  return {
    ...services,
    userId: session?.userId ?? null,
    sessionId: session?.sessionId ?? null,
    device,
    installationId,
  };
}
