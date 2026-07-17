import { type ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import { useQuery } from "@tanstack/react-query";
import { PrimaryButton } from "~/components/PrimaryButton";
import { SignInScreen } from "~/components/SignInScreen";
import { registerDevice, setAuthToken } from "./api";
import { DEVICE_STORAGE_KEY, TOKEN_STORAGE_KEY, USER_STORAGE_KEY, useAuthStore } from "./auth-store";
import { getStoredItem, setStoredItem } from "./secure-storage";

/**
 * The session hooks live in auth-session.ts so SignInScreen's provider hooks
 * can import them without a require cycle through this file; this re-export
 * keeps ~/lib/auth as the app-facing surface (settings, etc.).
 */
export { useApplyAuthResult, useSignOut } from "./auth-session";

/**
 * Load the persisted install identity + session (19-auth.md). The deviceId is
 * minted once per install — it identifies this device for push tokens. The
 * session token is the only credential: present → signed in, absent → the
 * SignInScreen. Runs as a react-query query so the async storage read needs no
 * effect orchestration.
 */
async function bootstrapAuth(): Promise<null> {
  const storedDeviceId = await getStoredItem(DEVICE_STORAGE_KEY);
  const deviceId = storedDeviceId ?? Crypto.randomUUID();
  if (!storedDeviceId) {
    await setStoredItem(DEVICE_STORAGE_KEY, deviceId);
  }
  const token = await getStoredItem(TOKEN_STORAGE_KEY);
  const userId = await getStoredItem(USER_STORAGE_KEY);
  setAuthToken(token, deviceId);
  useAuthStore.setState({ deviceId, userId, status: token ? "signedIn" : "signedOut" });
  if (token) {
    registerDevice(deviceId).catch(() => {
      // Fire-and-forget: if the session is stale this 401s once, and the
      // consecutive-401 handler in api.ts signs the user out when the app's
      // own requests confirm it.
    });
  }
  // The store is the source of truth for signed-in state; nothing reads this.
  return null;
}

/**
 * Gates the app on a live session: signed in → the app, signed out → the
 * full-screen SignInScreen. The bootstrap query only reads local storage, so
 * failure is a broken install rather than a network blip.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const bootstrap = useQuery({
    queryKey: ["auth", "bootstrap"],
    queryFn: bootstrapAuth,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 2,
  });

  if (bootstrap.isError) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-8 gap-6">
        <Text className="text-[15px] leading-[1.6] text-ink/55 text-center">
          hmm, i couldn’t wake up just now. mind trying again?
        </Text>
        <View className="w-full max-w-xs">
          <PrimaryButton label="Try again" onPress={() => bootstrap.refetch()} />
        </View>
      </View>
    );
  }

  if (status === "loading") {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator color="#111111" />
      </View>
    );
  }

  if (status === "signedOut") {
    return <SignInScreen />;
  }

  return <>{children}</>;
}
