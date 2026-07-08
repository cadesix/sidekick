import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";

/** A titled group of settings rows (07 §9). */
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mb-7">
      <Text className="text-[12px] font-medium text-ink/40 mb-2 px-1">{title}</Text>
      <View>{children}</View>
    </View>
  );
}

/**
 * A single settings row: label (+ optional subtitle) with a right-side control.
 * Adding a new setting is one `<SettingsRow>` usage. Rows use a plain hairline
 * divider (07 §9). Pass `right` for a toggle/value, or `onPress` + no `right` to
 * get a chevron.
 */
export function SettingsRow({
  label,
  subtitle,
  right,
  onPress,
  destructive = false,
}: {
  label: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  destructive?: boolean;
}) {
  const chevron = onPress ? <ChevronRight size={20} color="rgba(17,17,17,0.3)" strokeWidth={2.5} /> : null;
  const rightNode = right ?? chevron;
  const body = (
    <View className="flex-row items-center justify-between py-4 border-b border-ink/12">
      <View className="flex-1 pr-3">
        <Text className={`text-[16px] font-bold ${destructive ? "text-red-600" : "text-ink"}`}>{label}</Text>
        {subtitle ? <Text className="text-[13px] leading-[1.4] text-ink/55 mt-0.5">{subtitle}</Text> : null}
      </View>
      {rightNode}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} className="active:opacity-60">
        {body}
      </Pressable>
    );
  }
  return body;
}
