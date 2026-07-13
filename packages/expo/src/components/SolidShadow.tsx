import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { INK } from "~/lib/tokens";

/**
 * The brand's signature surface (06 §2): a 2px ink border with a hard, non-blurred
 * 2px offset ink shadow rendered as a second view behind the content. Pressing
 * translates the content onto its shadow, matching the web PRESS token exactly.
 * This is the ONLY correct way to get the crisp offset shadow in RN — never use
 * `shadow-*` for the hard brand shadow.
 */
export function SolidShadow({
  children,
  onPress,
  onLongPress,
  disabled = false,
  radius = 16,
  className = "",
}: {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  radius?: number;
  className?: string;
}) {
  const interactive = Boolean(onPress ?? onLongPress) && !disabled;
  return (
    <View style={{ position: "relative" }}>
      <View
        style={{
          position: "absolute",
          left: 2,
          top: 2,
          right: -2,
          bottom: -2,
          backgroundColor: INK,
          borderRadius: radius,
        }}
      />
      {interactive ? (
        <Pressable
          onPress={onPress}
          onLongPress={onLongPress}
          style={({ pressed }) => ({
            borderWidth: 2,
            borderColor: INK,
            borderRadius: radius,
            transform: pressed ? [{ translateX: 2 }, { translateY: 2 }] : [],
          })}
          className={className}
        >
          {children}
        </Pressable>
      ) : (
        <View
          style={{ borderWidth: 2, borderColor: INK, borderRadius: radius }}
          className={className}
        >
          {children}
        </View>
      )}
    </View>
  );
}
