import { Hono } from "hono";
import type { Services } from "../context";
import { ExpoPushProvider } from "./expo-provider";
import { checkNotificationReceipts, sendPendingNotifications } from "./outbox";

export function buildNotificationsCron(services: Services): Hono {
  const app = new Hono();
  const provider = new ExpoPushProvider(process.env.EXPO_ACCESS_TOKEN);
  app.get("/notifications/send", async (c) =>
    c.json(await sendPendingNotifications(services.db, provider, new Date())),
  );
  app.get("/notifications/receipts", async (c) =>
    c.json(await checkNotificationReceipts(services.db, provider, new Date())),
  );
  return app;
}
