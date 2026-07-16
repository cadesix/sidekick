/**
 * Apple Music API surface behind a small interface (12-life-integrations.md).
 * `HttpAppleMusicClient` is the real Vercel-side impl; `ScriptedAppleMusicClient`
 * (./scripted) is the in-memory stand-in for tests. Both throw `AppleMusicApiError`
 * on a non-2xx so callers can map 403 → token-revoked. This file is bundled into
 * the mobile app via the shared tool registry, so it stays node-free: `fetch` +
 * tokens passed in, never `jose`/`node:crypto`.
 */

export type MusicSong = { id: string; title: string; artist: string };
export type MusicRecommendation = { id: string; title: string; kind: string };
export type HeavyRotationItem = { id: string; name: string; artistName?: string };

export class AppleMusicApiError extends Error {
  constructor(
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `apple music api error ${status}`);
    this.name = "AppleMusicApiError";
  }
}

export interface AppleMusicClient {
  storefront(): Promise<string>;
  searchSongs(query: string, limit?: number): Promise<MusicSong[]>;
  createPlaylist(name: string, description: string, songIds: string[]): Promise<{ id: string }>;
  addTracks(playlistId: string, songIds: string[]): Promise<void>;
  recommendations(): Promise<MusicRecommendation[]>;
  heavyRotation(): Promise<HeavyRotationItem[]>;
  topArtists(): Promise<string[]>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type HttpConfig = {
  developerToken: string;
  userToken: string;
  storefront?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
};

const DEFAULT_BASE = "https://api.music.apple.com";

type CatalogJson = { results?: { songs?: { data?: RawResource[] } } };
type RawResource = {
  id: string;
  type?: string;
  attributes?: { name?: string; artistName?: string };
};
type RelationshipJson = { data?: RawResource[] };

/** The real Apple Music client. All calls carry the developer + music-user tokens. */
export class HttpAppleMusicClient implements AppleMusicClient {
  private readonly fetchImpl: FetchLike;
  private cachedStorefront: string | null;

  constructor(private readonly config: HttpConfig) {
    this.fetchImpl = config.fetchImpl ?? ((url, init) => fetch(url, init));
    this.cachedStorefront = config.storefront ?? null;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.developerToken}`,
      "music-user-token": this.config.userToken,
      "content-type": "application/json",
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const base = this.config.baseUrl ?? DEFAULT_BASE;
    const response = await this.fetchImpl(`${base}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      throw new AppleMusicApiError(response.status);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  async storefront(): Promise<string> {
    if (this.cachedStorefront) {
      return this.cachedStorefront;
    }
    const json = await this.request<RelationshipJson>("/v1/me/storefront");
    const id = json.data?.[0]?.id ?? "us";
    this.cachedStorefront = id;
    return id;
  }

  async searchSongs(query: string, limit = 5): Promise<MusicSong[]> {
    const storefront = await this.storefront();
    const params = new URLSearchParams({ term: query, types: "songs", limit: String(limit) });
    const json = await this.request<CatalogJson>(
      `/v1/catalog/${storefront}/search?${params.toString()}`,
    );
    const data = json.results?.songs?.data ?? [];
    return data.map((song) => ({
      id: song.id,
      title: song.attributes?.name ?? "",
      artist: song.attributes?.artistName ?? "",
    }));
  }

  async createPlaylist(
    name: string,
    description: string,
    songIds: string[],
  ): Promise<{ id: string }> {
    const body = {
      attributes: { name, description },
      relationships: {
        tracks: { data: songIds.map((id) => ({ id, type: "songs" })) },
      },
    };
    const json = await this.request<RelationshipJson>("/v1/me/library/playlists", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const id = json.data?.[0]?.id ?? "";
    return { id };
  }

  async addTracks(playlistId: string, songIds: string[]): Promise<void> {
    await this.request(`/v1/me/library/playlists/${playlistId}/tracks`, {
      method: "POST",
      body: JSON.stringify({ data: songIds.map((id) => ({ id, type: "songs" })) }),
    });
  }

  async recommendations(): Promise<MusicRecommendation[]> {
    const json = await this.request<{ data?: RawResource[] }>("/v1/me/recommendations");
    return (json.data ?? []).map((rec) => ({
      id: rec.id,
      title: rec.attributes?.name ?? "",
      kind: rec.type ?? "recommendation",
    }));
  }

  async heavyRotation(): Promise<HeavyRotationItem[]> {
    const json = await this.request<{ data?: RawResource[] }>("/v1/me/history/heavy-rotation");
    return (json.data ?? []).map((item) => ({
      id: item.id,
      name: item.attributes?.name ?? "",
      artistName: item.attributes?.artistName,
    }));
  }

  async topArtists(): Promise<string[]> {
    const json = await this.request<{ data?: RawResource[] }>(
      "/v1/me/library/artists?limit=15",
    );
    return (json.data ?? []).map((artist) => artist.attributes?.name ?? "").filter((n) => n.length > 0);
  }
}
