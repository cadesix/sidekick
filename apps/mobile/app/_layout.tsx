import "../global.css";
import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthGate } from "~/lib/auth";
import { syncHealth } from "~/lib/api";
import { maybeRefreshFocusShield } from "~/lib/focus";
import { readHealthDays } from "~/lib/health";
import { maybeUpdateLocation } from "~/lib/location";

const queryClient = new QueryClient();

/**
 * On every foreground, push fresh HealthKit days and refresh coarse location
 * (12-life-integrations.md). Both underlying calls are safe no-ops when the user
 * hasn't connected / has denied permission. An `AppState` subscription is the
 * accepted RN mechanism for a foreground trigger, so this is a justified useEffect.
 */
function useForegroundSync(): void {
  useEffect(() => {
    async function sync(): Promise<void> {
      try {
        const days = await readHealthDays(7);
        if (days.length > 0) {
          await syncHealth(days);
        }
      } catch {
        // health not shared / unavailable — no-op
      }
      await maybeUpdateLocation();
      try {
        await maybeRefreshFocusShield();
      } catch {
        // focus not set up / entitlement missing — no-op
      }
    }
    function onChange(state: AppStateStatus): void {
      if (state === "active") {
        void sync();
      }
    }
    void sync();
    const subscription = AppState.addEventListener("change", onChange);
    return () => subscription.remove();
  }, []);
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    "Diatype-Rounded": require("../assets/fonts/ABCDiatypeRounded.ttf"),
  });
  useForegroundSync();

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthGate>
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#fff" } }} />
          </AuthGate>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
