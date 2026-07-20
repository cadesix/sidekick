import { expect, test } from "vitest";
import { disabledFeatures, parseServerEnv } from "@sidekick/server";

const valid = {
  DATABASE_URL: "postgres://localhost:5432/sidekick",
  OPENAI_API_KEY: "sk-test",
};

test("a minimal valid environment parses and defaults NODE_ENV to development", () => {
  const env = parseServerEnv(valid);
  expect(env.NODE_ENV).toBe("development");
  expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
});

test("every missing required var is reported in one message, not one per restart", () => {
  const attempt = () => parseServerEnv({});
  expect(attempt).toThrow(/DATABASE_URL/);
  expect(attempt).toThrow(/OPENAI_API_KEY/);
});

test("a blank var is treated as unset rather than as an empty string", () => {
  expect(parseServerEnv({ ...valid, GRAVITY_API_KEY: "   " }).GRAVITY_API_KEY).toBeUndefined();
  expect(() => parseServerEnv({ ...valid, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
});

test("a malformed value is rejected with the reason, not silently accepted", () => {
  expect(() => parseServerEnv({ ...valid, DATABASE_URL: "mysql://host/db" })).toThrow(/postgres/);
  expect(() => parseServerEnv({ ...valid, PUBLIC_API_URL: "not-a-url" })).toThrow(/PUBLIC_API_URL/);
  expect(() => parseServerEnv({ ...valid, MUSIC_TOKEN_KEY: "c2hvcnQ=" })).toThrow(/32 bytes/);
});

test("a half-configured integration fails rather than booting into a runtime error", () => {
  expect(() => parseServerEnv({ ...valid, RESEND_API_KEY: "re_test" })).toThrow(
    /RESEND_FROM_EMAIL/,
  );
  expect(() =>
    parseServerEnv({ ...valid, TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t" }),
  ).toThrow(/TWILIO_VERIFY_SERVICE_SID/);
});

test("a fully configured integration passes, and so does an entirely absent one", () => {
  const env = parseServerEnv({
    ...valid,
    RESEND_API_KEY: "re_test",
    RESEND_FROM_EMAIL: "Sidekick <hi@sidekickchat.app>",
  });
  expect(env.RESEND_FROM_EMAIL).toBe("Sidekick <hi@sidekickchat.app>");
  expect(parseServerEnv(valid).RESEND_API_KEY).toBeUndefined();
});

test("production additionally demands the vars whose absence is an outage", () => {
  const attempt = () => parseServerEnv({ ...valid, NODE_ENV: "production" });
  expect(attempt).toThrow(/CRON_SECRET/);
  expect(attempt).toThrow(/PUBLIC_API_URL/);
  expect(
    parseServerEnv({
      ...valid,
      NODE_ENV: "production",
      CRON_SECRET: "s3cret",
      PUBLIC_API_URL: "https://api.sidekickchat.app",
    }).NODE_ENV,
  ).toBe("production");
});

test("optional integrations that are off are named, so a missing key is visible at boot", () => {
  const off = disabledFeatures(parseServerEnv(valid));
  expect(off.some((entry) => entry.includes("SENTRY_DSN"))).toBe(true);
  expect(off.some((entry) => entry.includes("GRAVITY_API_KEY"))).toBe(true);
  expect(disabledFeatures(parseServerEnv({ ...valid, GRAVITY_API_KEY: "g" }))).not.toContain(
    "ads (GRAVITY_API_KEY)",
  );
});
