import { z } from "zod";

/**
 * A var that is present but blank (`FOO=` in a `.env`) means "unset", not "empty
 * string" — every optional var below would otherwise fail its `min(1)` check on a
 * commented-out-by-blanking line, which is how `.env.example` is written.
 */
function presentVars(source: NodeJS.ProcessEnv): Record<string, string> {
  const entries = Object.entries(source).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "",
  );
  return Object.fromEntries(entries);
}

const optional = z.string().min(1).optional();

const base64Key32 = z
  .string()
  .refine((value) => Buffer.from(value, "base64").length === 32, "must be a base64-encoded 32 bytes")
  .optional();

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"]).optional(),
  PORT: z.coerce.number().int().positive().optional(),

  DATABASE_URL: z.string().startsWith("postgres", "must be a postgres:// connection string"),
  /** OpenAI key for the chat model, voice-note transcription, and web search (09 §audio). */
  OPENAI_API_KEY: z.string().min(1),

  /** Public base URL of this server, for building attachment object URLs (09). */
  PUBLIC_API_URL: z.string().url().optional(),
  /** Bearer secret guarding `/cron/*`; unset locks the cron routes rather than exposing them. */
  CRON_SECRET: optional,
  /** Comma-separated exact origins allowed by CORS; unset means any origin (see `buildApp`). */
  CORS_ALLOWED_ORIGINS: optional,
  /** Sentry DSN for `sans-software/sidekick-server`; unset disables reporting entirely. */
  SENTRY_DSN: z.string().url().optional(),
  /** Railway-injected deploy metadata, surfaced by `GET /health` and as the Sentry release. */
  RAILWAY_GIT_COMMIT_SHA: optional,
  RAILWAY_ENVIRONMENT_NAME: optional,
  RAILWAY_DEPLOYMENT_ID: optional,

  /** Comma-separated tool names to withhold globally (feature flags, `web_search` included — 11). */
  SIDEKICK_DISABLED_TOOLS: optional,
  /** `1` runs the small-model IAB classification pass in the nightly ad-profile sweep. */
  SIDEKICK_AD_IAB_CLASSIFY: optional,

  /** Vercel Blob token; when set, attachments use Blob instead of local disk (09). */
  BLOB_READ_WRITE_TOKEN: optional,
  /** Local object-store directory when Blob is not configured (09). */
  LOCAL_BLOB_DIR: optional,

  /** Gravity ad-network key (05). Absent ⇒ ads disabled (the default posture). */
  GRAVITY_API_KEY: optional,
  /** Gravity API base URL override (05); defaults to server.trygravity.ai. */
  GRAVITY_API_URL: z.string().url().optional(),
  /** Paid inventory is opt-in; absent/false keeps Gravity in test mode. */
  GRAVITY_PRODUCTION: z.enum(["true", "false"]).optional(),

  EXPO_ACCESS_TOKEN: optional,
  /** OpenWeatherMap key for check-in openers (03); unset skips the weather signal. */
  WEATHER_API_KEY: optional,

  /** Resend API key for email OTP (19-auth.md); unset ⇒ codes logged to console in dev. */
  RESEND_API_KEY: optional,
  /** Verified Resend sending address for email OTP (19-auth.md). */
  RESEND_FROM_EMAIL: z
    .string()
    .refine((value) => value.includes("@"), "must be an email address")
    .optional(),

  /** Twilio Verify credentials for SMS OTP (19-auth.md). */
  TWILIO_ACCOUNT_SID: optional,
  TWILIO_AUTH_TOKEN: optional,
  TWILIO_VERIFY_SERVICE_SID: optional,

  /** Apple sign-in audiences (19-auth.md); at least one is required to accept Apple tokens. */
  APP_BUNDLE_IDENTIFIER: optional,
  APPLE_SERVICES_ID: optional,

  /** Google sign-in audiences (19-auth.md); `expo-auth-session` mints for both. */
  GOOGLE_IOS_CLIENT_ID: optional,
  GOOGLE_WEB_CLIENT_ID: optional,

  /** MusicKit developer-token signing key (12 §music). */
  APPLE_MUSIC_PRIVATE_KEY: optional,
  APPLE_MUSIC_KEY_ID: optional,
  APPLE_MUSIC_TEAM_ID: optional,
  /** Base64 32-byte AES key encrypting Apple Music user tokens at rest (12 §music). */
  MUSIC_TOKEN_KEY: base64Key32,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Integrations that are useless half-configured: a Resend key with no sender, or
 * two of three Twilio values, boots a server that looks healthy and then fails on
 * the first user who tries to sign in. Each group must be all-set or all-unset.
 */
const featureGroups: { name: string; vars: (keyof ServerEnv)[] }[] = [
  { name: "Email OTP (Resend)", vars: ["RESEND_API_KEY", "RESEND_FROM_EMAIL"] },
  {
    name: "SMS OTP (Twilio Verify)",
    vars: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID"],
  },
  {
    name: "Apple Music",
    vars: ["APPLE_MUSIC_PRIVATE_KEY", "APPLE_MUSIC_KEY_ID", "APPLE_MUSIC_TEAM_ID"],
  },
];

/** Vars that are optional locally but whose absence is a production outage. */
const productionRequired: (keyof ServerEnv)[] = ["CRON_SECRET", "PUBLIC_API_URL"];

const schemaWithRules = serverEnvSchema.superRefine((env, ctx) => {
  for (const group of featureGroups) {
    const missing = group.vars.filter((name) => env[name] === undefined);
    if (missing.length > 0 && missing.length < group.vars.length) {
      for (const name of missing) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name],
          message: `required because ${group.name} is partially configured`,
        });
      }
    }
  }
  if (env.NODE_ENV !== "production") {
    return;
  }
  for (const name of productionRequired) {
    if (env[name] === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [name],
        message: "required when NODE_ENV=production",
      });
    }
  }
});

function formatIssues(error: z.ZodError): string {
  const lines = error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
  return `Invalid server environment:\n${[...new Set(lines)].sort().join("\n")}`;
}

/**
 * Validate an environment. Throws with every problem listed at once, so a
 * misconfigured deploy is fixed in one pass instead of one restart per variable.
 */
export function parseServerEnv(source: NodeJS.ProcessEnv): ServerEnv {
  const result = schemaWithRules.safeParse(presentVars(source));
  if (!result.success) {
    throw new Error(formatIssues(result.error));
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/** The validated process environment, parsed once per process. */
export function readEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

/**
 * Optional integrations that are simply off. Reported once at boot so a missing
 * key reads as a deliberate line in the logs rather than a mystery 501 later.
 */
export function disabledFeatures(env: ServerEnv): string[] {
  const checks: [string, string | number | undefined][] = [
    ["email OTP (RESEND_API_KEY)", env.RESEND_API_KEY],
    ["SMS OTP (TWILIO_ACCOUNT_SID)", env.TWILIO_ACCOUNT_SID],
    ["ads (GRAVITY_API_KEY)", env.GRAVITY_API_KEY],
    ["blob storage, using local disk (BLOB_READ_WRITE_TOKEN)", env.BLOB_READ_WRITE_TOKEN],
    ["push notifications (EXPO_ACCESS_TOKEN)", env.EXPO_ACCESS_TOKEN],
    ["weather in check-in openers (WEATHER_API_KEY)", env.WEATHER_API_KEY],
    ["Apple Music (APPLE_MUSIC_KEY_ID)", env.APPLE_MUSIC_KEY_ID],
    ["error reporting (SENTRY_DSN)", env.SENTRY_DSN],
  ];
  return checks.filter(([, value]) => value === undefined).map(([name]) => name);
}
