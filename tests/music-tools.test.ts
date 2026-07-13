import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { type Database, memories, users } from "@sidekick/db";
import { createTestDb } from "@sidekick/db/testing";
import {
  type MusicSong,
  type SidekickTool,
  type ToolContext,
  ScriptedAppleMusicClient,
  allTools,
  dispatchTool,
  setAppleMusicClientResolver,
} from "@sidekick/shared";
import { ingestMusicTaste, registerDevice } from "@sidekick/server";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

afterEach(() => {
  setAppleMusicClientResolver(async () => null);
});

const CATALOG: MusicSong[] = [
  { id: "s1", title: "Von Dutch", artist: "Charli XCX" },
  { id: "s2", title: "Espresso", artist: "Sabrina Carpenter" },
  { id: "s3", title: "Not Like Us", artist: "Kendrick Lamar" },
];

function musicTool(name: string): SidekickTool {
  const found = allTools.find((t) => t.name === name);
  if (!found) {
    throw new Error(`missing tool ${name}`);
  }
  return found;
}

async function connectedUser(deviceId: string, client: ScriptedAppleMusicClient) {
  const { userId } = await registerDevice(db, { deviceId });
  await db.update(users).set({ sidekickName: "Nova" }).where(eq(users.id, userId));
  setAppleMusicClientResolver(async () => client);
  const ctx: ToolContext = { db, userId, conversationId: "c" };
  return { userId, ctx };
}

test("music_search returns catalog hits", async () => {
  const client = new ScriptedAppleMusicClient({ catalog: CATALOG });
  const { ctx } = await connectedUser("music-search", client);
  const result = await dispatchTool(musicTool("music_search"), { query: "Espresso" }, ctx);
  expect(result.status).toBe("done");
  const done = result as { status: "done"; result: { songs: MusicSong[] } };
  expect(done.result.songs.map((s) => s.id)).toContain("s2");
});

test("music_make_playlist resolves queries, signs the description, and creates the playlist", async () => {
  const client = new ScriptedAppleMusicClient({ catalog: CATALOG });
  const { ctx } = await connectedUser("music-make", client);
  const result = await dispatchTool(
    musicTool("music_make_playlist"),
    { name: "5k pump-up", description: "for tomorrow's race", song_queries: ["Von Dutch", "Espresso"] },
    ctx,
  );
  expect(result.status).toBe("done");

  expect(client.created).toHaveLength(1);
  const playlist = client.created[0]!;
  expect(playlist.name).toBe("5k pump-up");
  expect(playlist.trackIds).toEqual(["s1", "s2"]);
  expect(playlist.description).toBe("for tomorrow's race — made by Nova 💛");
});

test("music_add_to_playlist adds resolved tracks", async () => {
  const client = new ScriptedAppleMusicClient({ catalog: CATALOG });
  const { ctx } = await connectedUser("music-add", client);
  await dispatchTool(
    musicTool("music_add_to_playlist"),
    { playlist_id: "pl_9", song_queries: ["Not Like Us"] },
    ctx,
  );
  expect(client.addedTracks).toEqual([{ playlistId: "pl_9", songIds: ["s3"] }]);
});

test("music_recommendations returns Apple's picks", async () => {
  const client = new ScriptedAppleMusicClient({
    recommendations: [{ id: "r1", title: "Chill Mix", kind: "playlist" }],
  });
  const { ctx } = await connectedUser("music-recs", client);
  const result = await dispatchTool(musicTool("music_recommendations"), {}, ctx);
  const done = result as { status: "done"; result: { recommendations: { id: string }[] } };
  expect(done.result.recommendations[0]?.id).toBe("r1");
});

test("a revoked token (403) surfaces as token_revoked", async () => {
  const client = new ScriptedAppleMusicClient({ catalog: CATALOG, throwStatus: 403 });
  const { ctx } = await connectedUser("music-403", client);
  const result = await dispatchTool(musicTool("music_search"), { query: "Espresso" }, ctx);
  const done = result as { status: "done"; result: { error?: string } };
  expect(done.result.error).toBe("token_revoked");
});

test("with no connection the tools report not_connected", async () => {
  const { userId } = await registerDevice(db, { deviceId: "music-none" });
  setAppleMusicClientResolver(async () => null);
  const ctx: ToolContext = { db, userId, conversationId: "c" };
  const result = await dispatchTool(musicTool("music_search"), { query: "x" }, ctx);
  const done = result as { status: "done"; result: { error?: string } };
  expect(done.result.error).toBe("not_connected");
});

test("taste ingestion writes interest memories with source 'import'", async () => {
  const { userId } = await registerDevice(db, { deviceId: "music-taste" });
  const client = new ScriptedAppleMusicClient({
    artists: ["Charli XCX", "Fred again.."],
    heavy: [{ id: "a1", name: "Brat", artistName: "Charli XCX" }],
  });

  const first = await ingestMusicTaste(db, userId, client);
  expect(first.added).toBe(3);

  const rows = await db.select().from(memories).where(eq(memories.userId, userId));
  expect(rows.every((m) => m.kind === "interest" && m.source === "import")).toBe(true);
  expect(rows.map((m) => m.content)).toContain("into Charli XCX");

  const second = await ingestMusicTaste(db, userId, client);
  expect(second.added).toBe(0);
});
