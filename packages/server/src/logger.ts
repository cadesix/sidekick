import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

/**
 * The server's structured logger (pino), matching FieldQuote's setup: pretty and
 * debug-level locally, JSON at info in production so Railway's log drain can index
 * it. `redact` is the last line of defence — a bearer token or OTP that reaches a
 * log call is censored rather than persisted to a third-party log store.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
        },
      }),
  base: { env: process.env.NODE_ENV },
  serializers: { err: pino.stdSerializers.err },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "headers.authorization",
      "authorization",
      "password",
      "token",
      "code",
      "apiKey",
      "secret",
    ],
    censor: "[REDACTED]",
  },
});

export type Logger = typeof logger;
