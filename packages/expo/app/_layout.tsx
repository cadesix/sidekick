import '../global.css';

import * as Sentry from '@sentry/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { PrimaryButton } from '~/components/PrimaryButton';
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
        {/* Onboarding: a full-screen 3D flow (not a modal), fade-swapped so the
            evening stage cross-dissolves with Home rather than sliding. */}
        <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
        <Stack.Screen name="sidekick-3d" options={{ presentation: 'modal' }} />
        {/* Profile (settings live inside it) can open over the natively-presented
            chat sheet — only modal presentations appear above it */}
        <Stack.Screen name="profile" options={{ presentation: 'modal' }} />
        <Stack.Screen name="focus-setup" options={{ presentation: 'modal' }} />
        <Stack.Screen name="health-setup" options={{ presentation: 'modal' }} />
        <Stack.Screen name="dev/index" options={{ presentation: 'modal' }} />
        <Stack.Screen name="dev/chat-lab" options={{ presentation: 'modal' }} />
        <Stack.Screen name="dev/ad-preview" options={{ presentation: 'modal' }} />
        <Stack.Screen name="dev/face-sheet" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}

/**
 * expo-router mounts this for any render error below the root layout. Without it
 * a throw leaves the Stack's white `contentStyle` on screen — its global handler
 * hides the splash, the JS VM keeps running, and nothing reaches Sentry, so a
 * fatal render bug looks exactly like a slow launch. Reporting here is what makes
 * that class of failure diagnosable from a TestFlight build.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <View className="flex-1 bg-white items-center justify-center px-8 gap-6">
      <Text className="text-[15px] leading-[1.6] text-ink/55 text-center">
        hmm, something went wrong on my end. mind trying again?
      </Text>
      <View className="w-full max-w-xs">
        <PrimaryButton label="Try again" onPress={retry} />
      </View>
    </View>
  );
}

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    // iOS won't synthesize bold for a custom font, so each weight is its own family.
    'Diatype-Rounded': require('../assets/fonts/ABCDiatypeRounded.ttf'),
    'Diatype-Rounded-Medium': require('../assets/fonts/ABCDiatypeRounded-Medium.otf'),
    'Diatype-Rounded-Bold': require('../assets/fonts/ABCDiatypeRounded-Bold.otf'),
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
