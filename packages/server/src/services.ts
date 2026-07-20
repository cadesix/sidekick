import * as Sentry from "@sentry/node";
import { createDb } from "@sidekick/db/client";
import { featureFlagsFromEnv, setAppleMusicClientResolver } from "@sidekick/shared";
import { Resend } from "resend";
import { gravityClientFromEnv } from "./ads/gravity";
import type { AuthEmailSender } from "./auth/email";
import { otpEmailHtml } from "./auth/email";
import { createTwilioSms } from "./auth/sms";
import type { Services } from "./context";
import { type ServerEnv, disabledFeatures, readEnv } from "./env";
import { logger } from "./logger";
import { createModel, createSessionModel, createTranscriptionModel } from "./model";
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
  void task().catch((error) => {
    logger.error({ err: error }, "background task failed");
    Sentry.captureException(error);
  });
}

/**
 * Email OTP delivery (19-auth.md). Resend when `RESEND_API_KEY`/`RESEND_FROM_EMAIL`
 * are set; otherwise, in development only, the code is logged to the console so
 * local email sign-in works without a Resend account. A production server missing
 * Resend config must NOT fall back to logging live OTPs to the server logs — it
 * throws at send time instead (mirroring the Twilio seam's lazy fail-closed).
 */
function createAuthEmail(env: ServerEnv): AuthEmailSender {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    return {
      sendOtp: async (email, code) => {
        if (env.NODE_ENV === "production") {
          throw new Error("Email OTP is not configured: set RESEND_API_KEY and RESEND_FROM_EMAIL");
        }
        logger.info(`[auth] email OTP for ${email}: ${code}`);
      },
    };
  }
  const resend = new Resend(env.RESEND_API_KEY);
  const from = env.RESEND_FROM_EMAIL;
  return {
    sendOtp: async (email, code) => {
      await resend.emails.send({
        from,
        to: email,
        subject: `${code} is your Sidekick verification code`,
        html: otpEmailHtml(code),
      });
    },
  };
}

/**
 * Build production services from env. Never called by tests. `readEnv` throws
 * here if anything required is missing or malformed, so a misconfigured deploy
 * fails at boot with the full list rather than at the first request that needs it.
 */
export function createServices(): Services {
  const env = readEnv();
  const off = disabledFeatures(env);
  if (off.length > 0) {
    logger.warn({ disabled: off }, "optional integrations are not configured");
  }
  const model = createModel(env);
  return {
    db: createDb(env.DATABASE_URL),
    model,
    flags: featureFlagsFromEnv({ SIDEKICK_DISABLED_TOOLS: env.SIDEKICK_DISABLED_TOOLS }),
    scheduleBackground: fireAndForget,
    storage: createStorage(env),
    captionModel: model,
    transcriptionModel: createTranscriptionModel(env),
    sessionModel: createSessionModel(env),
    adNetwork: gravityClientFromEnv(env),
    authEmail: createAuthEmail(env),
    sms: createTwilioSms(),
  };
}
