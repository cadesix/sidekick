export type ServerEnv = {
  DATABASE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  SIDEKICK_CHAT_MODEL?: string;
  /**
   * Comma-separated tool names to withhold globally (feature flags, `web_search`
   * / `web_fetch` included — 11). NOTE: web search must ALSO be enabled at the
   * Anthropic Console org level; if it's disabled org-wide, every turn that
   * offers the tool 400s silently, no matter this flag.
   */
  SIDEKICK_DISABLED_TOOLS?: string;
  CRON_SECRET?: string;
  /** Public base URL of this server, for building attachment object URLs (09). */
  PUBLIC_API_URL?: string;
  /** Vercel Blob token; when set, attachments use Blob instead of local disk (09). */
  BLOB_READ_WRITE_TOKEN?: string;
  /** Local object-store directory when Blob is not configured (09). */
  LOCAL_BLOB_DIR?: string;
  /** OpenAI key for voice-note transcription (09 §audio). */
  OPENAI_API_KEY?: string;
  /** Transcription model id, e.g. `gpt-4o-mini-transcribe` (09 §audio). */
  SIDEKICK_TRANSCRIBE_MODEL?: string;
  /** Gravity ad-network key (05). Absent ⇒ ads disabled (the default posture). */
  GRAVITY_API_KEY?: string;
  /** Gravity API base URL override (05); defaults to server.trygravity.ai. */
  GRAVITY_API_URL?: string;
  /** Paid inventory is opt-in; absent/false keeps Gravity in test mode. */
  GRAVITY_PRODUCTION?: string;
};

export function readEnv(): ServerEnv {
  const env = process.env;
  return {
    DATABASE_URL: env.DATABASE_URL,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    SIDEKICK_CHAT_MODEL: env.SIDEKICK_CHAT_MODEL,
    SIDEKICK_DISABLED_TOOLS: env.SIDEKICK_DISABLED_TOOLS,
    CRON_SECRET: env.CRON_SECRET,
    PUBLIC_API_URL: env.PUBLIC_API_URL,
    BLOB_READ_WRITE_TOKEN: env.BLOB_READ_WRITE_TOKEN,
    LOCAL_BLOB_DIR: env.LOCAL_BLOB_DIR,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    SIDEKICK_TRANSCRIBE_MODEL: env.SIDEKICK_TRANSCRIBE_MODEL,
    GRAVITY_API_KEY: env.GRAVITY_API_KEY,
    GRAVITY_API_URL: env.GRAVITY_API_URL,
    GRAVITY_PRODUCTION: env.GRAVITY_PRODUCTION,
  };
}
