import { useEffect, useState } from "react";
import * as Notifications from "expo-notifications";

/**
 * Push permission + token (02 §push). Called from the onboarding chat's push beat
 * after a soft pre-prompt. Requests permission, then best-effort fetches the Expo
 * push token — in a bare dev client without an EAS project id `getExpoPushTokenAsync`
 * throws, so the token is optional and the permission grant is what matters.
 */
export async function registerForPushToken(): Promise<{ granted: boolean; token: string | null }> {
  const current = await Notifications.getPermissionsAsync();
  const status =
    current.status === "granted"
      ? current.status
      : (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") {
    return { granted: false, token: null };
  }
  try {
    const token = await Notifications.getExpoPushTokenAsync();
    return { granted: true, token: token.data };
  } catch {
    return { granted: true, token: null };
  }
}

const DEEP_LINK_TYPES = new Set(["checkin", "reminder", "focus"]);

/**
 * Deep-link a notification tap into the chat sheet (03 check-in, 10 reminder). Both
 * carry `data.type`; the opener / reminder message is already in the main thread
 * server-side, so opening chat is all the client does. A notification response is
 * inherently asynchronous (it can arrive from a cold-start tap), so this is one of
 * the sanctioned `useEffect` cases; the handled-id guard keeps it from re-firing.
 */
export function useChatDeepLink(openChat: () => void): void {
  const response = Notifications.useLastNotificationResponse();
  const [handledId, setHandledId] = useState<string | null>(null);

  const request = response?.notification.request;
  const id = request?.identifier ?? null;
  const type = request?.content.data?.type;
  const shouldOpen = id !== null && id !== handledId && typeof type === "string" && DEEP_LINK_TYPES.has(type);

  useEffect(() => {
    if (shouldOpen && id !== null) {
      setHandledId(id);
      openChat();
    }
  }, [shouldOpen, id, openChat]);
}
