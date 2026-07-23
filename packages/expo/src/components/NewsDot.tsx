import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

// The wordless "there's news here" dot — one look shared by every surface that
// anchors it (dock tiles, the top-right map pin). Callers pass only the anchor
// offsets; the dot itself redesigns in one place.
export function NewsDot({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.dot, style]} pointerEvents="none" />;
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: '#FF3B30',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
  },
});
