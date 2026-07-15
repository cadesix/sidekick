import { useState } from 'react';
import { Pressable as RNPressable, type PressableProps } from 'react-native';

// Drop-in Pressable that fixes a NativeWind v4 gotcha: with `jsxImportSource:
// 'nativewind'`, function-form `style` on a Pressable (`style={({ pressed }) =>
// ...}`) is silently dropped — the returned styles never apply, so the element
// collapses (a tile renders 0×0, a button loses its background). We resolve the
// function ourselves against a pressed state we track, and hand RNPressable a
// plain style object, which NativeWind keeps. Non-function styles pass straight
// through, so this is a safe swap for the react-native Pressable anywhere.
export function Pressable({ style, onPressIn, onPressOut, ...props }: PressableProps) {
  const [pressed, setPressed] = useState(false);
  return (
    <RNPressable
      {...props}
      onPressIn={(e) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        onPressOut?.(e);
      }}
      style={typeof style === 'function' ? style({ pressed, hovered: false }) : style}
    />
  );
}
