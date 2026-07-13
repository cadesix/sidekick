import type { ReactNode } from "react";
import { Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useQuery } from "@tanstack/react-query";
import { PrimaryButton } from "~/components/PrimaryButton";
import { registerDevice, setAuthToken } from "./api";

const DEVICE_KEY = "sidekick.deviceId";
const TOKEN_KEY = "sidekick.token";

/**
 * Anonymous-auth bootstrap (07 deliverable 5). On first launch a device id is
 * generated and stored; registration is idempotent, so a relaunch re-attaches the
 * same account. The returned token is stored and set as the tRPC/stream auth
 * header. Runs once via React Query — no useEffect.
 */
export async function bootstrapAuth(): Promise<string> {
  const storedDeviceId = await SecureStore.getItemAsync(DEVICE_KEY);
  const deviceId = storedDeviceId ?? Crypto.randomUUID();
  if (!storedDeviceId) {
    await SecureStore.setItemAsync(DEVICE_KEY, deviceId);
  }
  const { userId, token } = await registerDevice(deviceId);
  setAuthToken(token);
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  return userId;
}

/**
 * Gates the app on a ready anonymous session. While registering, shows a blank
 * warm splash; on failure, an in-character retry.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useQuery({
    queryKey: ["auth", "bootstrap"],
    queryFn: bootstrapAuth,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 2,
  });

  if (auth.isSuccess) {
    return <>{children}</>;
  }

  if (auth.isError) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-8 gap-6">
        <Text className="text-[15px] leading-[1.6] text-ink/55 text-center">
          hmm, i couldn't wake up just now. mind trying again?
        </Text>
        <View className="w-full max-w-xs">
          <PrimaryButton label="Try again" onPress={() => auth.refetch()} />
        </View>
      </View>
    );
  }

  return <View className="flex-1 bg-white" />;
}
