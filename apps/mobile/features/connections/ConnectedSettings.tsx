import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Heart, MapPin, Music } from "lucide-react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BottomSheet } from "~/components/BottomSheet";
import { PrePermissionSheet } from "~/components/PrePermissionSheet";
import { PrimaryButton } from "~/components/PrimaryButton";
import { SettingsGroup } from "~/components/SettingsRow";
import {
  connectMusic,
  disconnectHealth,
  disconnectLocation,
  disconnectMusic,
  fetchMusicDeveloperToken,
  healthStatus,
  locationStatus,
  musicStatus,
  syncHealth,
} from "~/lib/api";
import { readHealthDays, requestHealthAuthorization } from "~/lib/health";
import { maybeUpdateLocation, requestLocationPermission } from "~/lib/location";
import {
  AppleMusicAuthProvider,
  authorizeAppleMusic,
  hasAppleMusicSubscription,
  useAppleMusicAuth,
} from "~/lib/music";

type Service = "health" | "location" | "music";
type SheetMode = "connect" | "detail";
type ActiveSheet = { service: Service; mode: SheetMode } | null;

const SHARED_COPY: Record<Service, string[]> = {
  health: [
    "your daily steps, sleep, and workouts — so you never have to report them.",
    "read-only. i can never write to Health or share it with anyone.",
  ],
  location: [
    "your city (never your exact location), only while you're using the app.",
    "it's how i know your weather and what's nearby.",
  ],
  music: [
    "your Apple Music taste and library, so i can make you playlists.",
    "playlists i make land in your library, signed by me.",
  ],
};

function ConnectionRow({
  icon,
  name,
  connected,
  onPress,
}: {
  icon: React.ReactNode;
  name: string;
  connected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="h-14 flex-row items-center justify-between active:opacity-60 border-b border-ink/12"
    >
      <View className="flex-row items-center gap-3">
        <View className="w-7 h-7 items-center justify-center">{icon}</View>
        <Text className="text-[16px] font-bold text-ink">{name}</Text>
      </View>
      {connected ? (
        <Text className="text-[14px] text-ink/60">Connected</Text>
      ) : (
        <View className="bg-ink/5 rounded-full px-3 py-1.5">
          <Text className="text-[13px] font-semibold text-ink">Connect</Text>
        </View>
      )}
    </Pressable>
  );
}

function DetailSheet({
  visible,
  onClose,
  title,
  shared,
  lastSynced,
  onDisconnect,
  disconnecting,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  shared: string[];
  lastSynced: string | null;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text className="text-[20px] font-extrabold text-ink mb-3">{title}</Text>
      <Text className="text-[13px] font-medium text-ink/40 mb-1.5">WHAT I CAN SEE</Text>
      {shared.map((line) => (
        <Text key={line} className="text-[15px] leading-[1.6] text-ink/70 mb-1.5">
          • {line}
        </Text>
      ))}
      {lastSynced ? (
        <Text className="text-[12px] text-ink/40 mt-3">Last synced {formatWhen(lastSynced)}</Text>
      ) : null}
      <Pressable
        onPress={onDisconnect}
        disabled={disconnecting}
        className="mt-6 border border-ink/20 rounded-full py-3.5 items-center active:opacity-60"
      >
        <Text className="text-[15px] font-bold text-flame">
          {disconnecting ? "Disconnecting…" : "Disconnect"}
        </Text>
      </Pressable>
      <Text className="text-[12px] text-ink/40 text-center mt-3">
        Disconnecting deletes it from our side too.
      </Text>
    </BottomSheet>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "recently";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ConnectedInner({ musicEnabled }: { musicEnabled: boolean }) {
  const qc = useQueryClient();
  const [active, setActive] = useState<ActiveSheet>(null);
  const [noSubscription, setNoSubscription] = useState(false);
  const music = useAppleMusicAuth();

  const health = useQuery({ queryKey: ["health", "status"], queryFn: healthStatus });
  const location = useQuery({ queryKey: ["location", "status"], queryFn: locationStatus });
  const musicState = useQuery({ queryKey: ["music", "status"], queryFn: musicStatus });

  const invalidate = (service: Service) => qc.invalidateQueries({ queryKey: [service, "status"] });
  const close = () => setActive(null);

  const connectHealth = useMutation({
    mutationFn: async () => {
      const granted = await requestHealthAuthorization();
      if (!granted) {
        return;
      }
      const days = await readHealthDays(7);
      if (days.length > 0) {
        await syncHealth(days);
      }
    },
    onSuccess: async () => {
      await invalidate("health");
      close();
    },
  });

  const connectLocation = useMutation({
    mutationFn: async () => {
      const granted = await requestLocationPermission();
      if (granted) {
        await maybeUpdateLocation();
      }
    },
    onSuccess: async () => {
      await invalidate("location");
      close();
    },
  });

  const connectMusicMutation = useMutation({
    mutationFn: async () => {
      const authorized = await authorizeAppleMusic();
      if (!authorized) {
        return;
      }
      const subscribed = await hasAppleMusicSubscription();
      if (!subscribed) {
        setNoSubscription(true);
        return;
      }
      const userToken = await music.requestAndGetToken();
      await connectMusic(userToken);
    },
    onSuccess: async () => {
      await invalidate("music");
      close();
    },
  });

  const disconnect = useMutation({
    mutationFn: async (service: Service) => {
      if (service === "health") {
        await disconnectHealth();
      } else if (service === "location") {
        await disconnectLocation();
      } else {
        await disconnectMusic();
      }
    },
    onSuccess: async (_data, service) => {
      await invalidate(service);
      close();
    },
  });

  const isConnected: Record<Service, boolean> = {
    health: health.data?.connected ?? false,
    location: location.data?.connected ?? false,
    music: musicState.data?.connected ?? false,
  };

  const openFor = (service: Service) => {
    setNoSubscription(false);
    setActive({ service, mode: isConnected[service] ? "detail" : "connect" });
  };

  return (
    <SettingsGroup title="Connected">
      <ConnectionRow
        icon={<Heart size={20} color="#111" strokeWidth={2.4} />}
        name="Apple Health"
        connected={isConnected.health}
        onPress={() => openFor("health")}
      />
      <ConnectionRow
        icon={<MapPin size={20} color="#111" strokeWidth={2.4} />}
        name="Location"
        connected={isConnected.location}
        onPress={() => openFor("location")}
      />
      {musicEnabled ? (
        <ConnectionRow
          icon={<Music size={20} color="#111" strokeWidth={2.4} />}
          name="Apple Music"
          connected={isConnected.music}
          onPress={() => openFor("music")}
        />
      ) : null}

      <PrePermissionSheet
        visible={active?.service === "health" && active.mode === "connect"}
        onClose={close}
        emoji="💛"
        title="want me to just see your steps and sleep?"
        body="so you never have to report anything. i can only read, never share."
        confirmLabel="connect Apple Health"
        onConfirm={() => connectHealth.mutate()}
        loading={connectHealth.isPending}
      />
      <PrePermissionSheet
        visible={active?.service === "location" && active.mode === "connect"}
        onClose={close}
        emoji="📍"
        title="mind if i know your city?"
        body="so i know your weather and what's nearby — only while you're using the app, only your city."
        confirmLabel="share my city"
        onConfirm={() => connectLocation.mutate()}
        loading={connectLocation.isPending}
      />
      <PrePermissionSheet
        visible={active?.service === "music" && active.mode === "connect"}
        onClose={close}
        emoji="🎧"
        title={noSubscription ? "you'd need Apple Music for this one 🥲" : "want me to make you playlists?"}
        body={
          noSubscription
            ? "making playlists needs an active Apple Music subscription."
            : "connect Apple Music and i'll build you playlists for the moments that matter."
        }
        confirmLabel={noSubscription ? "okay" : "connect Apple Music"}
        onConfirm={noSubscription ? close : () => connectMusicMutation.mutate()}
        loading={connectMusicMutation.isPending}
      />

      <DetailSheet
        visible={active?.mode === "detail"}
        onClose={close}
        title={active ? detailTitle(active.service) : ""}
        shared={active ? SHARED_COPY[active.service] : []}
        lastSynced={active ? lastSyncedFor(active.service, health.data, location.data, musicState.data) : null}
        onDisconnect={() => (active ? disconnect.mutate(active.service) : undefined)}
        disconnecting={disconnect.isPending}
      />
    </SettingsGroup>
  );
}

function detailTitle(service: Service): string {
  if (service === "health") {
    return "Apple Health";
  }
  if (service === "location") {
    return "Location";
  }
  return "Apple Music";
}

function lastSyncedFor(
  service: Service,
  health: { lastSyncedAt: string | null } | undefined,
  location: { lastLocatedAt: string | null } | undefined,
  music: { connectedAt: string | null } | undefined,
): string | null {
  if (service === "health") {
    return health?.lastSyncedAt ?? null;
  }
  if (service === "location") {
    return location?.lastLocatedAt ?? null;
  }
  return music?.connectedAt ?? null;
}

/**
 * The CONNECTED settings group (12-life-integrations.md §settings): three rows
 * for Apple Health, Location, Apple Music with pre-permission sheets, detail
 * sheets, and full disconnect cascades. Wrapped in the Apple Music auth provider
 * so the connect flow can mint a user token; the developer token is fetched from
 * our server (absent env → the music row is hidden).
 */
export function ConnectedSettings() {
  const devToken = useQuery({ queryKey: ["music", "devToken"], queryFn: fetchMusicDeveloperToken });
  return (
    <AppleMusicAuthProvider developerToken={devToken.data ?? undefined}>
      <ConnectedInner musicEnabled={Boolean(devToken.data)} />
    </AppleMusicAuthProvider>
  );
}
