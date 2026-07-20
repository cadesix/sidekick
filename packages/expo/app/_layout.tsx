import '../global.css';

import * as Sentry from '@sentry/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { AuthGate } from '~/lib/auth';
import { NotificationObserver } from '~/lib/notifications/observer';
import { useOtaUpdates } from '~/lib/ota-updates';
import { PostHogIdentify, PostHogProvider } from '~/lib/posthog';
import { queryClient } from '~/lib/query-client';
import { SentryIdentify } from '~/lib/sentry';
import { useForegroundSync } from '~/lib/useForegroundSync';

function ConnectedApp() {
  useForegroundSync();
  useOtaUpdates();

  return (
    <>
      <PostHogIdentify />
      <SentryIdentify />
      <NotificationObserver />
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fff' } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="sidekick-3d" options={{ presentation: 'modal' }} />
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

function RootLayout() {
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
            <PostHogProvider>
              <AuthGate>
                <ConnectedApp />
              </AuthGate>
            </PostHogProvider>
          </QueryClientProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
