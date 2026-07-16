import { and, eq } from "drizzle-orm";
import {
  messages,
  notificationOutbox,
  notificationPreferences,
  proactiveTurns,
} from "@sidekick/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ExpoPushProvider } from "../notifications/expo-provider";
import { registerPushToken, unregisterPushToken } from "../notifications/register";
import { protectedProcedure, router } from "../trpc";

const wallTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const registration = z.object({
  expoToken: z.string().min(1).max(512),
  platform: z.enum(["ios", "android"]),
  projectId: z.string().uuid(),
  permissionStatus: z.enum(["authorized", "provisional", "ephemeral"]),
});

function installationId(value: string | undefined): string {
  if (!value) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "missing installation id" });
  }
  return value;
}

export const notificationsRouter = router({
  registerDeviceToken: protectedProcedure.input(registration).mutation(async ({ ctx, input }) => {
    try {
      return await registerPushToken(
        ctx.db,
        new ExpoPushProvider(process.env.EXPO_ACCESS_TOKEN),
        ctx.userId,
        installationId(ctx.installationId),
        input,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "push registration failed";
      throw new TRPCError({ code: "BAD_REQUEST", message });
    }
  }),
  unregisterDeviceToken: protectedProcedure.mutation(async ({ ctx }) => {
    await unregisterPushToken(ctx.db, ctx.userId, installationId(ctx.installationId));
    return { ok: true };
  }),
  preferences: protectedProcedure.query(async ({ ctx }) => {
    await ctx.db
      .insert(notificationPreferences)
      .values({ userId: ctx.userId })
      .onConflictDoNothing();
    const rows = await ctx.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, ctx.userId))
      .limit(1);
    const preferences = rows[0];
    if (!preferences) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    }
    return preferences;
  }),
  updatePreferences: protectedProcedure
    .input(
      z.object({
        proactiveEnabled: z.boolean().optional(),
        checkinsEnabled: z.boolean().optional(),
        remindersEnabled: z.boolean().optional(),
        awakeStart: wallTime.optional(),
        awakeEnd: wallTime.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      await ctx.db
        .insert(notificationPreferences)
        .values({ userId: ctx.userId, ...input, updatedAt: now })
        .onConflictDoUpdate({
          target: notificationPreferences.userId,
          set: { ...input, updatedAt: now },
        });
      await ctx.db
        .update(proactiveTurns)
        .set({ status: "cancelled", cancellationReason: "preferences-changed", updatedAt: now })
        .where(
          and(
            eq(proactiveTurns.userId, ctx.userId),
            eq(proactiveTurns.status, "scheduled"),
          ),
        );
      return { ok: true };
    }),
  opened: protectedProcedure
    .input(z.object({ notificationId: z.string().uuid(), messageId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const outbox = await ctx.db
        .select({ id: notificationOutbox.id, proactiveTurnId: messages.proactiveTurnId })
        .from(notificationOutbox)
        .leftJoin(messages, eq(notificationOutbox.messageId, messages.id))
        .where(
          and(
            eq(notificationOutbox.id, input.notificationId),
            eq(notificationOutbox.userId, ctx.userId),
            eq(notificationOutbox.messageId, input.messageId),
          ),
        )
        .limit(1);
      if (!outbox[0]) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (outbox[0].proactiveTurnId) {
        const now = new Date();
        await ctx.db
          .update(proactiveTurns)
          .set({ openedAt: now, updatedAt: now })
          .where(eq(proactiveTurns.id, outbox[0].proactiveTurnId));
      }
      return { ok: true };
    }),
});
