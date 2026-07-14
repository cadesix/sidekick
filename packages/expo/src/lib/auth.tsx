import { type ReactNode, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PrimaryButton } from "~/components/PrimaryButton";
import {
  authStatus,
  createEmailAccount,
  registerDevice,
  setAuthToken,
  signInWithEmail,
} from "./api";

const DEVICE_KEY = "sidekick.deviceId";
const TOKEN_KEY = "sidekick.token";

/**
 * Anonymous-auth bootstrap (07 deliverable 5). On first launch a device id is
 * generated and stored; registration is idempotent, so a relaunch re-attaches the
 * same account. The returned token is stored and set as the tRPC/stream auth
 * header. Runs once via React Query — no useEffect.
 */
type AuthSession = { userId: string; deviceId: string; email: string | null };

async function bootstrapAuth(): Promise<AuthSession> {
  const storedDeviceId = await SecureStore.getItemAsync(DEVICE_KEY);
  const deviceId = storedDeviceId ?? Crypto.randomUUID();
  if (!storedDeviceId) {
    await SecureStore.setItemAsync(DEVICE_KEY, deviceId);
  }
  const { userId, token } = await registerDevice(deviceId);
  setAuthToken(token, deviceId);
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  const { email } = await authStatus();
  return { userId, deviceId, email };
}

function EmailAuth({ session, onAuthenticated }: { session: AuthSession; onAuthenticated: () => void }) {
  const [mode, setMode] = useState<"create" | "sign-in">("create");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      if (mode === "create") {
        await createEmailAccount({ email, password });
        return;
      }
      const result = await signInWithEmail({ deviceId: session.deviceId, email, password });
      setAuthToken(result.token, session.deviceId);
      await SecureStore.setItemAsync(TOKEN_KEY, result.token);
    },
    onSuccess: onAuthenticated,
  });

  const valid = email.includes("@") && password.length >= 8;
  const error = submit.error instanceof Error ? submit.error.message : null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-white justify-center px-7"
    >
      <Text className="text-[30px] font-bold text-ink">Welcome to Sidekick</Text>
      <Text className="text-[15px] leading-6 text-ink/55 mt-2 mb-8">
        {mode === "create"
          ? "Create an account to keep your chats with you."
          : "Sign in to continue to your chats."}
      </Text>
      <View className="gap-3">
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          placeholder="Email"
          className="h-12 rounded-2xl bg-black/5 px-4 text-[16px] text-ink"
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType={mode === "create" ? "newPassword" : "password"}
          placeholder="Password (8+ characters)"
          className="h-12 rounded-2xl bg-black/5 px-4 text-[16px] text-ink"
          onSubmitEditing={() => {
            if (valid) {
              submit.mutate();
            }
          }}
        />
      </View>
      {error ? <Text className="text-[13px] text-red-500 mt-3">{error}</Text> : null}
      <View className="mt-6">
        <PrimaryButton
          label={submit.isPending ? "One moment…" : mode === "create" ? "Create account" : "Sign in"}
          onPress={() => submit.mutate()}
          disabled={!valid}
          loading={submit.isPending}
        />
      </View>
      <Pressable
        className="items-center py-5"
        onPress={() => {
          setMode((current) => (current === "create" ? "sign-in" : "create"));
          submit.reset();
        }}
      >
        <Text className="text-[14px] font-semibold text-blue-500">
          {mode === "create" ? "Already have an account? Sign in" : "New here? Create an account"}
        </Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
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

  if (auth.isSuccess && auth.data.email) {
    return <>{children}</>;
  }

  if (auth.isSuccess) {
    return <EmailAuth session={auth.data} onAuthenticated={() => void auth.refetch()} />;
  }

  if (auth.isError) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-8 gap-6">
        <Text className="text-[15px] leading-[1.6] text-ink/55 text-center">
          hmm, i couldn’t wake up just now. mind trying again?
        </Text>
        <View className="w-full max-w-xs">
          <PrimaryButton label="Try again" onPress={() => auth.refetch()} />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white items-center justify-center gap-4">
      <ActivityIndicator color="#111111" />
      <Text className="text-[15px] text-ink/55">Waking up your Sidekick…</Text>
    </View>
  );
}
