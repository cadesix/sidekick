import { head, put } from "@vercel/blob";
import type { Storage, UploadTarget } from "./index";

/**
 * Vercel Blob object store (production, env-gated on `BLOB_READ_WRITE_TOKEN`).
 * Uploads currently route through the server's `/blob/:key` PUT proxy (same as
 * local), which calls `put()` here; direct-to-Blob presigning to skip the 4.5MB
 * function body limit is a follow-up isolated behind `createUploadTarget`.
 */
export class BlobStorage implements Storage {
  constructor(
    private readonly token: string,
    private readonly baseUrl: string,
  ) {}

  async createUploadTarget(input: { storageKey: string; mime: string }): Promise<UploadTarget> {
    return {
      uploadUrl: `${this.baseUrl}/blob/${input.storageKey}`,
      method: "PUT",
      headers: { "content-type": input.mime },
    };
  }

  async putObject(storageKey: string, data: Uint8Array, mime: string): Promise<void> {
    await put(storageKey, Buffer.from(data), {
      access: "public",
      contentType: mime,
      token: this.token,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }

  async getObject(storageKey: string): Promise<Uint8Array> {
    const meta = await head(this.publicUrl(storageKey), { token: this.token });
    const response = await fetch(meta.url);
    if (!response.ok) {
      throw new Error(`blob fetch failed (${response.status})`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  publicUrl(storageKey: string): string {
    return `${this.baseUrl}/blob/${storageKey}`;
  }
}
