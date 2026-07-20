import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { ChevronLeft, ChevronRight, MessageSquare, Box, Smile, Megaphone } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Dev hub: the single entry point for in-product dev tools, replacing the old
// packages/web admin tab router (deleted with the Vite app). Each tool is its
// own expo-router screen under app/dev/ (or a top-level modal). Add new labs
// here as they land — this is the scaffold the other web labs (Studio, Design
// Language, Graphic Assets) migrate into.

type Tool = { label: string; desc: string; href: Href; icon: typeof MessageSquare };

const TOOLS: Tool[] = [
  {
    label: 'Chat Lab',
    desc: 'iterate on the sidekick voice / texting traits',
    href: '/dev/chat-lab',
    icon: MessageSquare,
  },
  { label: '3D viewer', desc: 'look-dev the sidekick + cosmetics', href: '/sidekick-3d', icon: Box },
  { label: 'Face sheet', desc: 'QA the face expression grid', href: '/dev/face-sheet', icon: Smile },
  { label: 'Ad preview', desc: 'preview iMessage ad units', href: '/dev/ad-preview', icon: Megaphone },
];

export default function DevHubRoute() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top }}>
      {/* header */}
      <View className="flex-row items-center px-2 h-12">
        <Pressable
          accessibilityLabel="Back"
          onPress={() => router.back()}
          className="w-10 h-10 items-center justify-center"
        >
          <ChevronLeft size={26} color="#111" />
        </Pressable>
        <Text className="text-[17px] font-semibold text-ink">Dev tools</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        {TOOLS.map((t) => (
          <Pressable
            key={t.label}
            onPress={() => router.push(t.href)}
            className="flex-row items-center bg-black/[0.03] rounded-2xl px-4 py-4 mb-3"
          >
            <View className="w-10 h-10 rounded-full bg-black/[0.06] items-center justify-center mr-3">
              <t.icon size={20} color="#111" />
            </View>
            <View className="flex-1">
              <Text className="text-[16px] font-semibold text-ink">{t.label}</Text>
              <Text className="text-[13px] text-ink/40 mt-0.5">{t.desc}</Text>
            </View>
            <ChevronRight size={20} color="#00000033" />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
