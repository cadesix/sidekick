export type ServerEnv = {
  DATABASE_URL?: string;
  /**
   * Comma-separated tool names to withhold globally (feature flags, `web_search`
   * included — 11).
   */
  SIDEKICK_DISABLED_TOOLS?: string;
  CRON_SECRET?: string;
  /** Public base URL of this server, for building attachment object URLs (09). */
  PUBLIC_API_URL?: string;
  /** Vercel Blob token; when set, attachments use Blob instead of local disk (09). */
  BLOB_READ_WRITE_TOKEN?: string;
  /** Local object-store directory when Blob is not configured (09). */
  LOCAL_BLOB_DIR?: string;
  /** OpenAI key for the chat model, voice-note transcription, and web search (09 §audio). */
  OPENAI_API_KEY?: string;
  /** Gravity ad-network key (05). Absent ⇒ ads disabled (the default posture). */
  GRAVITY_API_KEY?: string;
  /** Gravity API base URL override (05); defaults to server.trygravity.ai. */
  GRAVITY_API_URL?: string;
  /** Paid inventory is opt-in; absent/false keeps Gravity in test mode. */
  GRAVITY_PRODUCTION?: string;
  EXPO_ACCESS_TOKEN?: string;
  /** Resend API key for email OTP (19-auth.md); unset ⇒ codes logged to console. */
  RESEND_API_KEY?: string;
  /** Verified Resend sending address for email OTP (19-auth.md). */
  RESEND_FROM_EMAIL?: string;
};

export function readEnv(): ServerEnv {
  const env = process.env;
  return {
    DATABASE_URL: env.DATABASE_URL,
    SIDEKICK_DISABLED_TOOLS: env.SIDEKICK_DISABLED_TOOLS,
    CRON_SECRET: env.CRON_SECRET,
    PUBLIC_API_URL: env.PUBLIC_API_URL,
    BLOB_READ_WRITE_TOKEN: env.BLOB_READ_WRITE_TOKEN,
    LOCAL_BLOB_DIR: env.LOCAL_BLOB_DIR,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    GRAVITY_API_KEY: env.GRAVITY_API_KEY,
    GRAVITY_API_URL: env.GRAVITY_API_URL,
    GRAVITY_PRODUCTION: env.GRAVITY_PRODUCTION,
    EXPO_ACCESS_TOKEN: env.EXPO_ACCESS_TOKEN,
    RESEND_API_KEY: env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: env.RESEND_FROM_EMAIL,
  };
}
