import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';

import { OnboardingChat } from '~/components/OnboardingChat';

// Standalone host for the onboarding conversation (docs/ONBOARDING-CONVERSATION.md).
// Deep-night background so the reading reads over "sky" even without the 3D
// canvas; in-product this will sit over the live night sky. Reach it at
// /onboarding.
export default function OnboardingRoute() {
  return (
    <View style={{ flex: 1, backgroundColor: '#0b0a1a' }}>
      <StatusBar style="light" />
      <OnboardingChat onDone={() => router.back()} />
    </View>
  );
}
