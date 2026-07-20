import * as Sentry from "@sentry/react-native";
import * as Updates from "expo-updates";
import { useEffect } from "react";
import { useAuthStore } from "./auth-store";

/**
 * Crash reporting is opt-in per environment, the same way PostHog is: with no
 * EXPO_PUBLIC_SENTRY_DSN the SDK initialises disabled and sends nothing, so dev
 * machines and CI need no Sentry project. Errors are still surfaced locally by
 * the red box / console.
 */
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: DSN,
  sendDefaultPii: true,
  enabled: !!DSN && process.env.NODE_ENV !== "development",
});

tagUpdateOrigin();

/**
 * Ties an event to the OTA update it came from, so a crash spike can be traced
 * to the `eas update` that caused it rather than just the store version.
 */
function tagUpdateOrigin() {
  const scope = Sentry.getGlobalScope();

  scope.setTag("expo-update-id", Updates.updateId);
  scope.setTag("expo-is-embedded-update", Updates.isEmbeddedLaunch);

  const manifest = Updates.manifest;
  const metadata = "metadata" in manifest ? manifest.metadata : undefined;
  const extra = "extra" in manifest ? manifest.extra : undefined;
  const updateGroup =
    metadata && "updateGroup" in metadata ? metadata.updateGroup : undefined;

  if (typeof updateGroup !== "string") {
    if (Updates.isEmbeddedLaunch) {
      scope.setTag("expo-update-debug-url", "not applicable for embedded updates");
    }
    return;
  }

  const owner = extra?.expoClient?.owner ?? "[account]";
  const slug = extra?.expoClient?.slug ?? "[project]";

  scope.setTag("expo-update-group-id", updateGroup);
  scope.setTag(
    "expo-update-debug-url",
    `https://expo.dev/accounts/${owner}/projects/${slug}/updates/${updateGroup}`,
  );
}

/**
 * Attaches the signed-in account to every event. Renders nothing — it exists so
 * the auth store subscription lives inside the React tree.
 */
export function SentryIdentify() {
  const userId = useAuthStore((state) => state.userId);

  useEffect(() => {
    Sentry.setUser(userId ? { id: userId } : null);
  }, [userId]);

  return null;
}
