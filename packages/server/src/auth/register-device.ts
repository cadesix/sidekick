import { type Database, devices } from "@sidekick/db";
import type { RegisterDeviceInput } from "@sidekick/shared";

/**
 * Upsert post-auth device metadata (19-auth.md). Keyed on `deviceId`, so a
 * physical device that signs into a different account repoints its `userId` and
 * bumps `lastSeenAt`.
 */
export async function registerDevice(
  db: Database,
  userId: string,
  input: RegisterDeviceInput,
): Promise<void> {
  await db
    .insert(devices)
    .values({ userId, deviceId: input.deviceId, publicKey: input.publicKey })
    .onConflictDoUpdate({
      target: devices.deviceId,
      set: { userId, lastSeenAt: new Date() },
    });
}
