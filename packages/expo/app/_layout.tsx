import '../global.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { syncHealth } from '~/lib/api';
import { bootstrapAuth } from '~/lib/auth';
import { maybeRefreshFocusShield } from '~/lib/focus';
import { readHealthDays } from '~/lib/health';
import { maybeUpdateLocation } from '~/lib/location';

const queryClient = new QueryClient();

// Warm the anonymous session as soon as the app boots so the chat sheet opens
// authed. Failures are absorbed here — AuthGate (mounted around the chat)
// owns retry UI, and the 3D home stays usable with the server unreachable.
void queryClient.prefetchQuery({
  queryKey: ['auth', 'bootstrap'],
  queryFn: bootstrapAuth,
  staleTime: Number.POSITIVE_INFINITY,
});

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
      if (state === 'active') {
        void sync();
      }
    }
    void sync();
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, []);
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    'Diatype-Rounded': require('../assets/fonts/ABCDiatypeRounded.ttf'),
  });
  useForegroundSync();

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
          </Stack>
          <StatusBar style="light" />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
