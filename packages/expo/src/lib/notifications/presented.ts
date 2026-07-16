import * as Notifications from "expo-notifications";
import { parseNotificationPayload } from "./payload";

export async function clearConversationNotifications(conversationId: string): Promise<void> {
  const presented = await Notifications.getPresentedNotificationsAsync();
  const matching = presented.filter((notification) => {
    const payload = parseNotificationPayload(notification.request.content.data);
    return payload?.conversationId === conversationId;
  });
  await Promise.all(
    matching.map((notification) =>
      Notifications.dismissNotificationAsync(notification.request.identifier),
    ),
  );
  await Notifications.setBadgeCountAsync(0);
}
