import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { Storage, UploadTarget } from "./index";

/**
 * A real local-filesystem object store (dev + tests — not a mock). Bytes live
 * under `baseDir`, keyed by `storageKey`; the client PUTs to and reads from the
 * server's `/blob/:key` route, which delegates here.
 */
export class LocalStorage implements Storage {
  private readonly root: string;

  constructor(
    baseDir: string,
    private readonly baseUrl: string,
  ) {
    this.root = resolve(baseDir);
  }

  private pathFor(storageKey: string): string {
    const path = resolve(this.root, storageKey);
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new Error("invalid storage key");
    }
    return path;
  }

  async createUploadTarget(input: { storageKey: string; mime: string }): Promise<UploadTarget> {
    return {
      uploadUrl: this.publicUrl(input.storageKey),
      method: "PUT",
      headers: { "content-type": input.mime },
    };
  }

  async putObject(storageKey: string, data: Uint8Array, _mime: string): Promise<void> {
    const path = this.pathFor(storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async getObject(storageKey: string): Promise<Uint8Array> {
    return readFile(this.pathFor(storageKey));
  }

  publicUrl(storageKey: string): string {
    return `${this.baseUrl}/blob/${storageKey}`;
  }
}
