import { useEffect, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import PostHog, { PostHogProvider as PostHogProviderReactNative, usePostHog } from "posthog-react-native";
import { useAuthStore } from "./auth-store";

/**
 * Analytics is opt-in per environment: with no EXPO_PUBLIC_POSTHOG_API_KEY the
 * provider still mounts (so usePostHog/capture calls stay valid everywhere) but
 * runs disabled against a placeholder key, sending nothing. Dev machines and CI
 * therefore need no PostHog project at all.
 */
const API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const NOOP_KEY = "phc_noop";
const isEnabled = !!API_KEY;

/** Remembers the last identified account so a cold start doesn't re-$identify. */
const LAST_IDENTIFY_KEY = "sidekick.posthog.lastIdentify";

export function PostHogProvider({ children }: { children: ReactNode }) {
  return (
    <PostHogProviderReactNative
      apiKey={API_KEY ?? NOOP_KEY}
      options={{
        enableSessionReplay: isEnabled,
        captureAppLifecycleEvents: isEnabled,
        disabled: !isEnabled,
      }}
      autocapture={{ captureScreens: isEnabled, captureTouches: false }}
    >
      {children}
    </PostHogProviderReactNative>
  );
}

/**
 * Ties PostHog's distinct id to the signed-in account so this install's events
 * land on one person. Renders nothing — it exists to run inside the provider.
 */
export function PostHogIdentify() {
  const posthog = usePostHog();
  const userId = useAuthStore((state) => state.userId);

  useEffect(() => {
    if (!isEnabled || !userId) {
      return;
    }
    identifyOnce(posthog, userId);
  }, [posthog, userId]);

  return null;
}

async function identifyOnce(posthog: PostHog, distinctId: string) {
  const last = await AsyncStorage.getItem(LAST_IDENTIFY_KEY).catch(() => null);
  if (last === distinctId) {
    return;
  }
  // A different account on the same install starts a fresh distinct id, so
  // account B's events never chain onto account A's person.
  if (last) {
    posthog.reset();
  }
  posthog.identify(distinctId);
  await AsyncStorage.setItem(LAST_IDENTIFY_KEY, distinctId).catch(() => {
    // Best effort: a failed write just means we identify again next launch.
  });
}
