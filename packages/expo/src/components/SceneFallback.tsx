import { Image } from 'expo-image';
import { View, type ViewStyle } from 'react-native';

/**
 * Lightweight stand-in for the GL scene on simulators and when 3D is disabled:
 * the meadow's sky colour with a static mascot, so the dock and sheets retain
 * their intended framing without initializing expo-gl.
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
