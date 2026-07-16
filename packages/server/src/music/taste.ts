import { and, eq } from "drizzle-orm";
import { type Database, memories } from "@sidekick/db";
import { type AppleMusicClient, bumpMemoryVersion } from "@sidekick/shared";

/** Cap on taste memories written per ingestion pass, so a big library stays bounded. */
const MAX_TASTE_MEMORIES = 15;

/**
 * Taste ingestion (12 §music): pull heavy-rotation + top library artists and turn
 * them into `interest` memories (`source:'import'`). Music taste is non-sensitive
 * and ad-projectable, and it immediately sharpens personalization. Deduped against
 * the user's existing active interests so reconnecting doesn't pile up duplicates.
 */
export async function ingestMusicTaste(
  db: Database,
  userId: string,
  client: AppleMusicClient,
): Promise<{ added: number }> {
  const [heavy, artists] = await Promise.all([client.heavyRotation(), client.topArtists()]);

  const sentences: string[] = [];
  for (const artist of artists) {
    sentences.push(`into ${artist}`);
  }
  for (const item of heavy) {
    const by = item.artistName ? ` by ${item.artistName}` : "";
    sentences.push(`has ${item.name}${by} on heavy rotation`);
  }

  const existing = await db
    .select({ content: memories.content })
    .from(memories)
    .where(and(eq(memories.userId, userId), eq(memories.status, "active")));
  const seen = new Set(existing.map((m) => m.content.trim().toLowerCase()));

  const toInsert: string[] = [];
  for (const sentence of sentences) {
    const key = sentence.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      toInsert.push(sentence);
    }
    if (toInsert.length >= MAX_TASTE_MEMORIES) {
      break;
    }
  }

  if (toInsert.length === 0) {
    return { added: 0 };
  }

  await db.insert(memories).values(
    toInsert.map((content) => ({
      userId,
      kind: "interest" as const,
      content,
      confidence: "stated",
      source: "import",
    })),
  );
  await bumpMemoryVersion(db, userId);
  return { added: toInsert.length };
}
