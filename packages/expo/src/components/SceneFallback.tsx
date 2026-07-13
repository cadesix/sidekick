import { Image } from 'expo-image';
import { View, type ViewStyle } from 'react-native';

/**
 * Stand-in for the GL scene when EXPO_PUBLIC_DISABLE_3D=1: the meadow's sky
 * colour with the mascot centred, so the dock and sheets sit on a backdrop that
 * frames them the way the real scene does.
 */
export function SceneFallback({ style }: { style?: ViewStyle }) {
  return (
    <View style={style} className="bg-sky items-center justify-center">
      <Image
        source={require('../../assets/sidekick-pfp.webp')}
        style={{ width: 180, height: 180 }}
        contentFit="contain"
      />
    </View>
  );
}
