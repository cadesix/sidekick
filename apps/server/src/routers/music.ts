import { eq } from "drizzle-orm";
import { z } from "zod";
import { type Database, musicAuth } from "@sidekick/db";
import { protectedProcedure, router } from "../trpc";
import { appleMusicClientFromToken } from "../music/client-factory";
import { encryptToken } from "../music/encryption";
import { ingestMusicTaste } from "../music/taste";

/**
 * Best-effort taste ingestion on connect. A network/403 hiccup here must never
 * fail the connect itself — the token is already stored, so the next tool call
 * (or a later reconnect) can still work.
 */
async function importTaste(
  db: Database,
  userId: string,
  userToken: string,
  storefront: string | null,
): Promise<number> {
  try {
    const client = await appleMusicClientFromToken(userToken, storefront);
    if (!client) {
      return 0;
    }
    const taste = await ingestMusicTaste(db, userId, client);
    return taste.added;
  } catch {
    return 0;
  }
}

/**
 * Apple Music surface (12). The user token is minted on-device and POSTed here,
 * where it's encrypted at rest. On connect we run one taste-ingestion pass
 * (heavy-rotation + top artists → `interest` memories). `disconnect` deletes the
 * stored token ("deleted from our side too").
 */
export const musicRouter = router({
  connect: protectedProcedure
    .input(z.object({ userToken: z.string().min(1), storefront: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { db, userId } = ctx;
      const values = {
        userId,
        userToken: encryptToken(input.userToken),
        storefront: input.storefront ?? null,
        connectedAt: new Date(),
      };
      await db
        .insert(musicAuth)
        .values(values)
        .onConflictDoUpdate({ target: musicAuth.userId, set: values });

      const tasteImported = await importTaste(db, userId, input.userToken, input.storefront ?? null);
      return { ok: true as const, tasteImported };
    }),

  status: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ storefront: musicAuth.storefront, connectedAt: musicAuth.connectedAt })
      .from(musicAuth)
      .where(eq(musicAuth.userId, ctx.userId))
      .limit(1);
    const row = rows[0];
    return {
      connected: Boolean(row),
      storefront: row?.storefront ?? null,
      connectedAt: row?.connectedAt ?? null,
    };
  }),

  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.delete(musicAuth).where(eq(musicAuth.userId, ctx.userId));
    return { ok: true as const, deleted: true };
  }),
});
