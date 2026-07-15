import '../global.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { syncHealth } from '~/lib/api';
import { AuthGate } from '~/lib/auth';
import { maybeRefreshFocusShield } from '~/lib/focus';
import { readHealthDays } from '~/lib/health';
import { HEALTH_CONNECTION_QUERY_KEY } from '~/lib/health-connection';
import { maybeUpdateLocation } from '~/lib/location';
import { NotificationObserver } from '~/lib/notifications/observer';

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
        const days = await readHealthDays(30);
        if (days.length > 0) {
          await syncHealth(days);
          await queryClient.invalidateQueries({ queryKey: HEALTH_CONNECTION_QUERY_KEY });
        }
      } catch {
        // health not shared / unavailable — no-op
      }
      try {
        await maybeUpdateLocation();
        await queryClient.invalidateQueries({ queryKey: ['location', 'setting'] });
      } catch {
        // location not shared / unavailable — no-op
      }
      try {
        await maybeRefreshFocusShield();
        await queryClient.invalidateQueries({ queryKey: ['focus-local'] });
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

function ConnectedApp() {
  useForegroundSync();

  return (
    <>
      <NotificationObserver />
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fff' } }}>
        <Stack.Screen name="index" />
        {/* Settings opens from inside the natively-presented chat
            sheet — only modal presentations appear above it */}
        <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
        <Stack.Screen name="focus-setup" options={{ presentation: 'modal' }} />
        <Stack.Screen name="health-setup" options={{ presentation: 'modal' }} />
        <Stack.Screen name="dev/ad-preview" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    'Diatype-Rounded': require('../assets/fonts/ABCDiatypeRounded.ttf'),
  });

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <QueryClientProvider client={queryClient}>
            <AuthGate>
              <ConnectedApp />
            </AuthGate>
          </QueryClientProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
