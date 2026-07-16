import { generateKeyPairSync, randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { importSPKI, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { type Database, musicAuth } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  LocalStorage,
  buildApp,
  decryptToken,
  encryptToken,
  mintDeveloperToken,
  registerDevice,
  type Services,
} from "@sidekick/server";
import { makeCaller, textModel } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
  delete process.env.APPLE_MUSIC_PRIVATE_KEY;
  delete process.env.APPLE_MUSIC_KEY_ID;
  delete process.env.APPLE_MUSIC_TEAM_ID;
  delete process.env.MUSIC_TOKEN_KEY;
});

function generatePkcs8(): string {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

function servicesFor(): Services {
  return {
    db,
    model: textModel("ok"),
    flags: {},
    scheduleBackground: () => {},
    storage: new LocalStorage("/tmp/sidekick-test-blob", "http://localhost/blob"),
    captionModel: textModel("ok"),
    adNetwork: null,
  };
}

test("mintDeveloperToken signs a verifiable ES256 JWT", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const env = {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    keyId: "KID12345",
    teamId: "TEAM6789",
  };
  const minted = await mintDeveloperToken(env, new Date("2026-07-06T00:00:00.000Z"));
  expect(minted).not.toBeNull();

  const spki = publicKey.export({ type: "spki", format: "pem" }).toString();
  const key = await importSPKI(spki, "ES256");
  const { payload, protectedHeader } = await jwtVerify(minted!.token, key);
  expect(protectedHeader.alg).toBe("ES256");
  expect(protectedHeader.kid).toBe("KID12345");
  expect(payload.iss).toBe("TEAM6789");
  expect(minted!.expiresAt.getTime()).toBeGreaterThan(Date.now());
});

test("mintDeveloperToken returns null when unconfigured", async () => {
  expect(await mintDeveloperToken({})).toBeNull();
  expect(await mintDeveloperToken({ keyId: "x", teamId: "y" })).toBeNull();
});

test("the developer-token endpoint 501s unconfigured and 200s once configured", async () => {
  delete process.env.APPLE_MUSIC_PRIVATE_KEY;
  delete process.env.APPLE_MUSIC_KEY_ID;
  delete process.env.APPLE_MUSIC_TEAM_ID;

  const { token } = await registerDevice(db, { deviceId: "music-devtoken" });
  const app = buildApp(servicesFor());
  const auth = { authorization: `Bearer ${token}` };

  const unconfigured = await app.request("/music/developer-token", { headers: auth });
  expect(unconfigured.status).toBe(501);

  const unauthorized = await app.request("/music/developer-token");
  expect(unauthorized.status).toBe(401);

  process.env.APPLE_MUSIC_PRIVATE_KEY = generatePkcs8();
  process.env.APPLE_MUSIC_KEY_ID = "KID12345";
  process.env.APPLE_MUSIC_TEAM_ID = "TEAM6789";

  const configured = await app.request("/music/developer-token", { headers: auth });
  expect(configured.status).toBe(200);
  const body = (await configured.json()) as { token: string; expiresAt: string };
  expect(body.token.split(".")).toHaveLength(3);
});

test("token encryption round-trips and hides the plaintext", () => {
  process.env.MUSIC_TOKEN_KEY = randomBytes(32).toString("base64");
  const cipher = encryptToken("super-secret-music-user-token");
  expect(cipher.startsWith("gcm:")).toBe(true);
  expect(cipher).not.toContain("super-secret-music-user-token");
  expect(decryptToken(cipher)).toBe("super-secret-music-user-token");

  delete process.env.MUSIC_TOKEN_KEY;
  const plain = encryptToken("dev-token");
  expect(plain).toBe("plain:dev-token");
  expect(decryptToken(plain)).toBe("dev-token");
});

test("connect stores an encrypted token; disconnect deletes it (cascade)", async () => {
  delete process.env.APPLE_MUSIC_PRIVATE_KEY;
  delete process.env.APPLE_MUSIC_KEY_ID;
  delete process.env.APPLE_MUSIC_TEAM_ID;
  process.env.MUSIC_TOKEN_KEY = randomBytes(32).toString("base64");
  const { userId } = await registerDevice(db, { deviceId: "music-connect" });
  const caller = makeCaller(db, textModel("ok"), userId);

  const connected = await caller.music.connect({ userToken: "user-token-abc", storefront: "us" });
  expect(connected.ok).toBe(true);

  const stored = await db.select().from(musicAuth).where(eq(musicAuth.userId, userId)).limit(1);
  expect(stored[0]?.userToken).not.toBe("user-token-abc");
  expect(decryptToken(stored[0]!.userToken)).toBe("user-token-abc");

  const status = await caller.music.status();
  expect(status.connected).toBe(true);
  expect(status.storefront).toBe("us");

  await caller.music.disconnect();
  const after = await db.select().from(musicAuth).where(eq(musicAuth.userId, userId));
  expect(after).toHaveLength(0);
  delete process.env.MUSIC_TOKEN_KEY;
});
