import { z } from "zod";

const payloadSchema = z.object({
  notificationId: z.string().uuid(),
  type: z.string(),
  conversationId: z.string().uuid(),
  messageId: z.number().int().positive(),
  proactiveTurnId: z.string().uuid().optional(),
  sequence: z.number().int().nonnegative().optional(),
});

export type NotificationPayload = z.infer<typeof payloadSchema>;

export function parseNotificationPayload(value: unknown): NotificationPayload | null {
  const result = payloadSchema.safeParse(value);
  if (!result.success) {
    return null;
  }
  return result.data;
}
