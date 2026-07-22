import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { trpc } from "../api";
import { parseNotificationPayload } from "./payload";
import { clearConversationNotifications } from "./presented";
import { refreshPushRegistration } from "./registration";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export function NotificationObserver(): null {
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    // Push notifications are native-only; expo-notifications throws on web
    // (e.g. getLastNotificationResponseAsync), so the observer no-ops there.
    if (Platform.OS === "web") {
      return;
    }
    function received(notification: Notifications.Notification): void {
      const payload = parseNotificationPayload(notification.request.content.data);
      if (!payload) {
        return;
      }
      void queryClient.invalidateQueries({
        queryKey: ["chat", "transcript", payload.conversationId],
      });
      // the home dock's unread badge reads a head-of-transcript page — refresh
      // it so a proactive message badges while the user sits on home
      void queryClient.invalidateQueries({ queryKey: ["chat", "head"] });
    }

    async function responded(response: Notifications.NotificationResponse): Promise<void> {
      const payload = parseNotificationPayload(response.notification.request.content.data);
      if (!payload) {
        return;
      }
      await trpc.notifications.opened.mutate({
        notificationId: payload.notificationId,
        messageId: payload.messageId,
      });
      router.replace({ pathname: "/", params: { messageId: String(payload.messageId) } });
      await clearConversationNotifications(payload.conversationId);
      await Notifications.clearLastNotificationResponseAsync();
    }

    const receivedSubscription = Notifications.addNotificationReceivedListener(received);
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void responded(response);
    });
    const tokenSubscription = Notifications.addPushTokenListener(() => {
      void refreshPushRegistration();
    });
    void refreshPushRegistration();
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        void responded(response);
      }
    });
    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
      tokenSubscription.remove();
    };
  }, [queryClient, router]);

  return null;
}
