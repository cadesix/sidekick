import type { ServerEnv } from "../env";
import { BlobStorage } from "./blob";
import { LocalStorage } from "./local";

/**
 * Where an attachment's bytes live (09 §storage). Two implementations: Vercel
 * Blob in production (env-gated on `BLOB_READ_WRITE_TOKEN`) and a real
 * local-filesystem store used in dev and tests — no mock, the same interface end
 * to end.
 */
export interface Storage {
  /**
   * A target the client PUTs the object's bytes to. Both implementations point
   * the client at our `/blob/:key` route, which streams straight into the backing
   * store — direct-to-Blob presigning (to skip the 4.5MB function body limit) is a
   * later optimization; the interface already isolates it here.
   */
  createUploadTarget(input: {
    storageKey: string;
    mime: string;
    bytes: number;
  }): Promise<UploadTarget>;
  /** Write bytes (the `/blob` route and tests seeding fixtures both use this). */
  putObject(storageKey: string, data: Uint8Array, mime: string): Promise<void>;
  /** Read raw bytes back for the ingest pipeline. */
  getObject(storageKey: string): Promise<Uint8Array>;
  /** The URL the model and the app fetch the object from. */
  publicUrl(storageKey: string): string;
}

export type UploadTarget = {
  uploadUrl: string;
  method: "PUT" | "POST";
  headers: Record<string, string>;
};

/**
 * Build the object store from env: Vercel Blob when a token is present, else the
 * local-filesystem store rooted at `LOCAL_BLOB_DIR` (default `.blob-store`).
 */
export function createStorage(env: ServerEnv): Storage {
  const baseUrl = env.PUBLIC_API_URL ?? "http://localhost:8787";
  if (env.BLOB_READ_WRITE_TOKEN) {
    return new BlobStorage(env.BLOB_READ_WRITE_TOKEN, baseUrl);
  }
  return new LocalStorage(env.LOCAL_BLOB_DIR ?? ".blob-store", baseUrl);
}

export { LocalStorage } from "./local";
export { BlobStorage } from "./blob";
