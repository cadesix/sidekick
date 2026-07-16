import { and, eq } from "drizzle-orm";
import { type Database, devicePushTokens, devices, notificationOutbox } from "@sidekick/db";
import type { PushProvider } from "./provider";

export type TokenRegistration = {
  expoToken: string;
  platform: "ios" | "android";
  projectId: string;
  permissionStatus: "authorized" | "provisional" | "ephemeral";
};

export async function registerPushToken(
  db: Database,
  provider: PushProvider,
  userId: string,
  installationId: string,
  input: TokenRegistration,
  now: Date = new Date(),
): Promise<{ id: string }> {
  if (!provider.validToken(input.expoToken)) {
    throw new Error("invalid Expo push token");
  }
  const owned = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.deviceId, installationId)))
    .limit(1);
  const device = owned[0];
  if (!device) {
    throw new Error("installation does not belong to user");
  }

  const rows = await db
    .insert(devicePushTokens)
    .values({
      deviceId: device.id,
      userId,
      expoToken: input.expoToken,
      platform: input.platform,
      projectId: input.projectId,
      permissionStatus: input.permissionStatus,
      status: "active",
      lastRegisteredAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [devicePushTokens.deviceId, devicePushTokens.projectId],
      set: {
        deviceId: device.id,
        userId,
        expoToken: input.expoToken,
        permissionStatus: input.permissionStatus,
        status: "active",
        lastRegisteredAt: now,
        invalidatedAt: null,
        lastError: null,
        updatedAt: now,
      },
    })
    .returning({ id: devicePushTokens.id });
  const row = rows[0];
  if (!row) {
    throw new Error("failed to register push token");
  }
  return row;
}

export async function unregisterPushToken(
  db: Database,
  userId: string,
  installationId: string,
  now: Date = new Date(),
): Promise<void> {
  const owned = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.deviceId, installationId)))
    .limit(1);
  const device = owned[0];
  if (!device) {
    return;
  }
  const disabled = await db
    .update(devicePushTokens)
    .set({ status: "disabled", invalidatedAt: now, updatedAt: now })
    .where(and(eq(devicePushTokens.deviceId, device.id), eq(devicePushTokens.status, "active")))
    .returning({ id: devicePushTokens.id });
  for (const token of disabled) {
    await db
      .update(notificationOutbox)
      .set({ status: "cancelled", lastError: "notifications disabled", updatedAt: now })
      .where(
        and(
          eq(notificationOutbox.devicePushTokenId, token.id),
          eq(notificationOutbox.status, "pending"),
        ),
      );
  }
}
