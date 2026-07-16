import {
  type AppleMusicClient,
  AppleMusicApiError,
  type HeavyRotationItem,
  type MusicRecommendation,
  type MusicSong,
} from "./client";

export type ScriptedConfig = {
  storefront?: string;
  catalog?: MusicSong[];
  recommendations?: MusicRecommendation[];
  heavy?: HeavyRotationItem[];
  artists?: string[];
  /** When set, every method throws `AppleMusicApiError` with this status (403 → revoked). */
  throwStatus?: number;
};

type CreatedPlaylist = { id: string; name: string; description: string; trackIds: string[] };

/**
 * In-memory Apple Music client for tests — real code, not a mock. It resolves
 * queries against a seeded catalog (substring match on title or artist) and
 * records the playlists it creates and the tracks added, so a test can assert on
 * the exact write. `throwStatus` simulates a revoked token (403).
 */
export class ScriptedAppleMusicClient implements AppleMusicClient {
  readonly created: CreatedPlaylist[] = [];
  readonly addedTracks: { playlistId: string; songIds: string[] }[] = [];
  private counter = 0;

  constructor(private readonly config: ScriptedConfig = {}) {}

  private guard(): void {
    if (this.config.throwStatus) {
      throw new AppleMusicApiError(this.config.throwStatus);
    }
  }

  async storefront(): Promise<string> {
    this.guard();
    return this.config.storefront ?? "us";
  }

  async searchSongs(query: string, limit = 5): Promise<MusicSong[]> {
    this.guard();
    const needle = query.toLowerCase();
    const catalog = this.config.catalog ?? [];
    return catalog
      .filter(
        (song) =>
          song.title.toLowerCase().includes(needle) || song.artist.toLowerCase().includes(needle),
      )
      .slice(0, limit);
  }

  async createPlaylist(
    name: string,
    description: string,
    songIds: string[],
  ): Promise<{ id: string }> {
    this.guard();
    this.counter += 1;
    const id = `pl_${this.counter}`;
    this.created.push({ id, name, description, trackIds: songIds });
    return { id };
  }

  async addTracks(playlistId: string, songIds: string[]): Promise<void> {
    this.guard();
    this.addedTracks.push({ playlistId, songIds });
  }

  async recommendations(): Promise<MusicRecommendation[]> {
    this.guard();
    return this.config.recommendations ?? [];
  }

  async heavyRotation(): Promise<HeavyRotationItem[]> {
    this.guard();
    return this.config.heavy ?? [];
  }

  async topArtists(): Promise<string[]> {
    this.guard();
    return this.config.artists ?? [];
  }
}
