import { afterAll, beforeAll, expect, test } from "vitest";
import { type Database } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  LocalStorage,
  type Services,
  buildApp,
  createUpload,
  registerDevice,
} from "@sidekick/server";
import { textModel } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

const VOICE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

function servicesFor(storage: LocalStorage): Services {
  return {
    db,
    model: textModel("ok"),
    flags: {},
    scheduleBackground: () => {},
    storage,
    captionModel: textModel("ok"),
    adNetwork: null,
  };
}

/** A stored voice note, plus the app that serves it. */
async function storedVoice(): Promise<{ app: ReturnType<typeof buildApp>; url: string }> {
  const storage = new LocalStorage("/tmp/sidekick-test-blob-serving", "http://localhost:8787");
  const { userId } = await registerDevice(db, { deviceId: "blob-serving" });
  const upload = await createUpload(db, storage, userId, {
    kind: "audio",
    mime: "audio/x-m4a",
    bytes: VOICE.byteLength,
    durationMs: 6000,
  });
  await storage.putObject(upload.storageKey, VOICE, "audio/x-m4a");
  return { app: buildApp(servicesFor(storage)), url: `http://localhost:8787/blob/${upload.storageKey}` };
}

/**
 * AVFoundation (the app's voice bubbles) refuses a media URL that answers with an
 * unrecognized content type, so the attachment's stored mime has to come back.
 */
test("a stored attachment is served with its own mime type", async () => {
  const { app, url } = await storedVoice();

  const response = await app.request(url);

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("audio/x-m4a");
  expect(response.headers.get("accept-ranges")).toBe("bytes");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(VOICE);
});

/** AVFoundation probes with a byte range before it will play anything. */
test("a ranged read answers 206 with just that slice", async () => {
  const { app, url } = await storedVoice();

  const response = await app.request(url, { headers: { range: "bytes=2-5" } });

  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe(`bytes 2-5/${VOICE.byteLength}`);
  expect(response.headers.get("content-length")).toBe("4");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(VOICE.slice(2, 6));
});

test("an open-ended range runs to the last byte", async () => {
  const { app, url } = await storedVoice();

  const response = await app.request(url, { headers: { range: "bytes=6-" } });

  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe(`bytes 6-9/${VOICE.byteLength}`);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(VOICE.slice(6));
});

test("a range past the end falls back to the whole object", async () => {
  const { app, url } = await storedVoice();

  const response = await app.request(url, { headers: { range: "bytes=99-200" } });

  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(VOICE);
});
