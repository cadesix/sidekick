import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@sidekick/db";
import { AppleMusicApiError } from "../music/client";
import { resolveAppleMusicClient } from "../music/resolver";
import {
  musicAddToPlaylist,
  musicMakePlaylist,
  musicRecommendations,
  musicSearch,
} from "../music/service";
import type { AppleMusicClient } from "../music/client";
import { defineTool, type SidekickTool, type ToolContext } from "./types";

type ToolFailure = { error: "not_connected" | "token_revoked" };

/**
 * Run one music tool against the user's stored token. Resolves the client (server
 * decrypts the token + mints a developer token); a missing connection returns
 * `not_connected`, and Apple's 403 (revoked token, 12 §tools) returns
 * `token_revoked` so the model asks the user to reconnect next session.
 */
async function withMusicClient<T>(
  ctx: ToolContext,
  run: (client: AppleMusicClient) => Promise<T>,
): Promise<T | ToolFailure> {
  const client = await resolveAppleMusicClient(ctx.db, ctx.userId);
  if (!client) {
    return { error: "not_connected" };
  }
  try {
    return await run(client);
  } catch (error) {
    if (error instanceof AppleMusicApiError && error.status === 403) {
      return { error: "token_revoked" };
    }
    throw error;
  }
}

async function sidekickName(ctx: ToolContext): Promise<string> {
  const rows = await ctx.db
    .select({ sidekickName: users.sidekickName })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1);
  return rows[0]?.sidekickName ?? "your sidekick";
}

export const musicTools: SidekickTool[] = [
  defineTool({
    name: "music_search",
    description:
      "Search the Apple Music catalog in the user's storefront. Use to check a song exists or grab its details before referencing it.",
    execution: "server",
    parameters: z.object({
      query: z.string().min(1),
      types: z.array(z.string()).optional().describe("Catalog types, e.g. ['songs']. Defaults to songs."),
    }),
    execute: (input, ctx) => withMusicClient(ctx, (client) => musicSearch(client, { query: input.query })),
  }),

  defineTool({
    name: "music_make_playlist",
    description:
      "Make a playlist in the user's Apple Music library from a list of song descriptions (each is resolved by catalog search). Playlists are gifts — offer them at meaningful moments, ask first except for milestones. The description is auto-signed with your name.",
    execution: "server",
    parameters: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      song_queries: z.array(z.string().min(1)).min(1).max(50),
    }),
    execute: (input, ctx) =>
      withMusicClient(ctx, async (client) =>
        musicMakePlaylist(client, {
          name: input.name,
          description: input.description,
          songQueries: input.song_queries,
          sidekickName: await sidekickName(ctx),
        }),
      ),
  }),

  defineTool({
    name: "music_add_to_playlist",
    description:
      "Add songs (by description, resolved via catalog search) to an existing playlist the user owns — e.g. 'add that to my running playlist'.",
    execution: "server",
    parameters: z.object({
      playlist_id: z.string().min(1),
      song_queries: z.array(z.string().min(1)).min(1).max(50),
    }),
    execute: (input, ctx) =>
      withMusicClient(ctx, (client) =>
        musicAddToPlaylist(client, {
          playlistId: input.playlist_id,
          songQueries: input.song_queries,
        }),
      ),
  }),

  defineTool({
    name: "music_recommendations",
    description:
      "Get Apple Music's personalized recommendations for the user, for 'what should I listen to' turns.",
    execution: "server",
    parameters: z.object({}),
    execute: (_input, ctx) => withMusicClient(ctx, (client) => musicRecommendations(client)),
  }),
];
