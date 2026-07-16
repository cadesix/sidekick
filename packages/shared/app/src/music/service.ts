import type { AppleMusicClient, MusicRecommendation, MusicSong } from "./client";

/** The signature every sidekick-made playlist carries (12 §music_make_playlist). */
export function signPlaylistDescription(description: string | undefined, sidekickName: string): string {
  const signature = `made by ${sidekickName} 💛`;
  const trimmed = (description ?? "").trim();
  if (trimmed.length === 0) {
    return signature;
  }
  return `${trimmed} — ${signature}`;
}

/** Resolve each free-text song query to its top catalog hit; drop the misses. */
async function resolveQueries(
  client: AppleMusicClient,
  queries: string[],
): Promise<{ songs: MusicSong[]; missing: string[] }> {
  const results = await Promise.all(queries.map((query) => client.searchSongs(query, 1)));
  const songs: MusicSong[] = [];
  const missing: string[] = [];
  results.forEach((hits, i) => {
    const top = hits[0];
    if (top) {
      songs.push(top);
      return;
    }
    const query = queries[i];
    if (query !== undefined) {
      missing.push(query);
    }
  });
  return { songs, missing };
}

export type SearchResult = { songs: MusicSong[] };

export async function musicSearch(
  client: AppleMusicClient,
  input: { query: string; limit?: number },
): Promise<SearchResult> {
  const songs = await client.searchSongs(input.query, input.limit ?? 10);
  return { songs };
}

export type MakePlaylistResult = {
  playlistId: string;
  name: string;
  added: MusicSong[];
  missing: string[];
};

export async function musicMakePlaylist(
  client: AppleMusicClient,
  input: { name: string; description?: string; songQueries: string[]; sidekickName: string },
): Promise<MakePlaylistResult> {
  const { songs, missing } = await resolveQueries(client, input.songQueries);
  const description = signPlaylistDescription(input.description, input.sidekickName);
  const { id } = await client.createPlaylist(
    input.name,
    description,
    songs.map((s) => s.id),
  );
  return { playlistId: id, name: input.name, added: songs, missing };
}

export type AddToPlaylistResult = { added: MusicSong[]; missing: string[] };

export async function musicAddToPlaylist(
  client: AppleMusicClient,
  input: { playlistId: string; songQueries: string[] },
): Promise<AddToPlaylistResult> {
  const { songs, missing } = await resolveQueries(client, input.songQueries);
  if (songs.length > 0) {
    await client.addTracks(
      input.playlistId,
      songs.map((s) => s.id),
    );
  }
  return { added: songs, missing };
}

export type RecommendationsResult = { recommendations: MusicRecommendation[] };

export async function musicRecommendations(
  client: AppleMusicClient,
): Promise<RecommendationsResult> {
  const recommendations = await client.recommendations();
  return { recommendations };
}
