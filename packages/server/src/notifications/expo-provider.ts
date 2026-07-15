import { Expo } from "expo-server-sdk";
import type { ExpoPushMessage, ExpoPushReceipt, ExpoPushTicket } from "expo-server-sdk";
import type { PushMessage, PushProvider, PushReceipt, PushTicket } from "./provider";

function ticketResult(ticket: ExpoPushTicket): PushTicket {
  if (ticket.status === "ok") {
    return { status: "ok", id: ticket.id };
  }
  return {
    status: "error",
    message: ticket.message,
    code: ticket.details?.error,
  };
}

function receiptResult(receipt: ExpoPushReceipt): PushReceipt {
  if (receipt.status === "ok") {
    return { status: "ok" };
  }
  return {
    status: "error",
    message: receipt.message,
    code: receipt.details?.error,
  };
}

function expoMessage(message: PushMessage): ExpoPushMessage {
  return {
    to: message.token,
    title: message.title,
    body: message.body,
    data: message.data,
    sound: "default",
    priority: "high",
    interruptionLevel: "active",
    ttl: message.expiresInSeconds,
    badge: message.badge,
    mutableContent: message.mutableContent,
  };
}

export class ExpoPushProvider implements PushProvider {
  private readonly client: Expo;

  constructor(accessToken?: string) {
    this.client = new Expo({ accessToken });
  }

  validToken(token: string): boolean {
    return Expo.isExpoPushToken(token);
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const chunks = this.client.chunkPushNotifications(messages.map(expoMessage));
    const results: PushTicket[] = [];
    for (const chunk of chunks) {
      const tickets = await this.client.sendPushNotificationsAsync(chunk);
      results.push(...tickets.map(ticketResult));
    }
    return results;
  }

  async receipts(ids: string[]): Promise<Record<string, PushReceipt>> {
    const chunks = this.client.chunkPushNotificationReceiptIds(ids);
    const results: Record<string, PushReceipt> = {};
    for (const chunk of chunks) {
      const receipts = await this.client.getPushNotificationReceiptsAsync(chunk);
      for (const [id, receipt] of Object.entries(receipts)) {
        results[id] = receiptResult(receipt);
      }
    }
    return results;
  }
}
