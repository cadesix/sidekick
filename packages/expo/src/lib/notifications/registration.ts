import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { trpc } from "../api";

type AllowedPermission = "authorized" | "provisional" | "ephemeral";

function allowedPermission(
  status: Notifications.NotificationPermissionsStatus,
): AllowedPermission | null {
  if (Platform.OS !== "ios") {
    return status.granted ? "authorized" : null;
  }
  const iosStatus = status.ios?.status;
  if (iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED) {
    return "authorized";
  }
  if (iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return "provisional";
  }
  if (iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL) {
    return "ephemeral";
  }
  return null;
}

function projectId(): string {
  const value = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Expo project ID is missing");
  }
  return value;
}

export async function currentNotificationPermission(): Promise<AllowedPermission | null> {
  return allowedPermission(await Notifications.getPermissionsAsync());
}

export async function enablePushNotifications(): Promise<boolean> {
  let status = await Notifications.getPermissionsAsync();
  if (!allowedPermission(status)) {
    status = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
  }
  const permissionStatus = allowedPermission(status);
  if (!permissionStatus) {
    return false;
  }
  const id = projectId();
  const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
  await trpc.notifications.registerDeviceToken.mutate({
    expoToken: token.data,
    platform: Platform.OS === "android" ? "android" : "ios",
    projectId: id,
    permissionStatus,
  });
  return true;
}

export async function refreshPushRegistration(): Promise<void> {
  const permission = await currentNotificationPermission();
  if (!permission) {
    return;
  }
  try {
    await enablePushNotifications();
  } catch {
    // Expo token acquisition is network-bound and is retried on the next foreground.
  }
}
