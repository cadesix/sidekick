import { createDb } from "@sidekick/db/client";
import { featureFlagsFromEnv, setAppleMusicClientResolver } from "@sidekick/shared";
import { Resend } from "resend";
import { gravityClientFromEnv } from "./ads/gravity";
import type { AuthEmailSender } from "./auth/email";
import { otpEmailHtml } from "./auth/email";
import { createTwilioSms } from "./auth/sms";
import type { Services } from "./context";
import { type ServerEnv, readEnv } from "./env";
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

/**
 * Email OTP delivery (19-auth.md). Resend when `RESEND_API_KEY`/`RESEND_FROM_EMAIL`
 * are set; otherwise the code is logged to the console — invoice's dev behavior, so
 * local email sign-in works without a Resend account.
 */
function createAuthEmail(env: ServerEnv): AuthEmailSender {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    return {
      sendOtp: async (email, code) => {
        console.log(`[auth] email OTP for ${email}: ${code}`);
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
    authEmail: createAuthEmail(env),
    sms: createTwilioSms(),
  };
}
