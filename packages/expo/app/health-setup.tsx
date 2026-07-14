import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PrimaryButton } from "~/components/PrimaryButton";
import { disconnectHealth, syncHealth } from "~/lib/api";
import {
  healthAvailable,
  readHealthDays,
  requestHealthAuthorization,
  setHealthAgentSharingEnabled,
} from "~/lib/health";
import { HEALTH_CONNECTION_QUERY_KEY, loadHealthConnection } from "~/lib/health-connection";

function Metric({ symbol, title, detail }: { symbol: SFSymbol; title: string; detail: string }) {
  return (
    <View style={styles.metric}>
      <View style={styles.metricIcon}>
        <SymbolView name={symbol} size={18} weight="semibold" tintColor="#FF375F" />
      </View>
      <View style={styles.metricCopy}>
        <Text style={styles.metricTitle}>{title}</Text>
        <Text style={styles.metricDetail}>{detail}</Text>
      </View>
    </View>
  );
}

function formattedSyncDate(value: Date | string | null): string {
  if (!value) {
    return "Waiting for available data";
  }
  return `Last synced ${new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

export default function HealthSetup() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const connection = useQuery({
    queryKey: HEALTH_CONNECTION_QUERY_KEY,
    queryFn: loadHealthConnection,
  });
  const connected = connection.data?.sharingEnabled ?? false;

  const connect = useMutation({
    mutationFn: async () => {
      await setHealthAgentSharingEnabled(true);
      try {
        const authorized = await requestHealthAuthorization();
        if (!authorized) {
          throw new Error("authorization cancelled");
        }
        const days = await readHealthDays(30);
        if (days.length > 0) {
          await syncHealth(days);
        }
      } catch (error) {
        await setHealthAgentSharingEnabled(false);
        throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: HEALTH_CONNECTION_QUERY_KEY });
      Alert.alert("Apple Health is connected", "Sidekick can now use the summaries you chose to share.");
    },
    onError: () => {
      Alert.alert(
        "Apple Health wasn't connected",
        "No data was uploaded. You can try again whenever you're ready.",
      );
    },
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      await setHealthAgentSharingEnabled(false);
      return disconnectHealth();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: HEALTH_CONNECTION_QUERY_KEY });
      Alert.alert("Disconnected", "Sidekick deleted its stored Apple Health summaries.");
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: HEALTH_CONNECTION_QUERY_KEY });
      Alert.alert(
        "Sharing is off",
        "Sidekick stopped future uploads, but server deletion is still pending. Tap Delete stored summaries to retry.",
      );
    },
  });

  const refresh = useMutation({
    mutationFn: async () => {
      const days = await readHealthDays(30);
      if (days.length === 0) {
        return { synced: 0, logged: 0 };
      }
      return syncHealth(days);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: HEALTH_CONNECTION_QUERY_KEY });
      if (result.synced === 0) {
        Alert.alert("No summaries available", "Sidekick didn’t find readable Health data yet.");
        return;
      }
      Alert.alert("Summaries refreshed", "Sidekick is up to date with Apple Health.");
    },
    onError: () => {
      Alert.alert("Refresh failed", "Your existing summaries are unchanged. Try again in a moment.");
    },
  });

  async function openHealthApp(): Promise<void> {
    const url = "x-apple-health://";
    if (await Linking.canOpenURL(url)) {
      await Linking.openURL(url);
      return;
    }
    await Linking.openSettings();
  }

  function confirmDisconnect(): void {
    Alert.alert(
      "Disconnect Apple Health?",
      "Future uploads stop immediately, and Sidekick deletes its stored summaries. Your Health app data is unchanged.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Disconnect & Delete", style: "destructive", onPress: () => disconnect.mutate() },
      ],
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable accessibilityLabel="Back" onPress={() => router.back()} style={styles.headerButton}>
          <SymbolView name="chevron.left" size={20} weight="semibold" tintColor="#0A84FF" />
        </Pressable>
        <Text style={styles.headerTitle}>Apple Health</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 190 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroIcon}>
          <SymbolView name="heart.fill" size={42} weight="semibold" tintColor="#FF375F" />
        </View>

        {connected ? (
          <View>
            <Text style={styles.title}>Connected, on your terms.</Text>
            <Text style={styles.body}>
              Sidekick can use the four daily summary groups you approved to support goals and answer your questions.
            </Text>
            <View style={styles.statusCard}>
              <View style={styles.statusRow}>
                <View style={styles.statusDot} />
                <View style={styles.statusCopy}>
                  <Text style={styles.statusTitle}>Sharing with Sidekick is on</Text>
                  <Text style={styles.statusDetail}>
                    {formattedSyncDate(connection.data?.status?.lastSyncedAt ?? null)}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        ) : (
          <View>
            <Text style={styles.title}>A little context, less manual tracking.</Text>
            <Text style={styles.body}>
              Let Sidekick use a small set of Apple Health summaries to support everyday goals and answer questions you ask.
            </Text>
          </View>
        )}

        <Text style={styles.groupLabel}>WHAT SIDEKICK CAN USE</Text>
        <View style={styles.card}>
          <Metric symbol="figure.walk" title="Steps" detail="Daily total" />
          <View style={styles.divider} />
          <Metric symbol="bed.double.fill" title="Sleep" detail="Duration and sleep window" />
          <View style={styles.divider} />
          <Metric symbol="figure.run" title="Workouts" detail="Type, start time, and duration" />
          <View style={styles.divider} />
          <Metric symbol="flame.fill" title="Active energy" detail="Daily total" />
        </View>

        <Text style={styles.groupLabel}>HOW SHARING WORKS</Text>
        <View style={styles.privacyCard}>
          <View style={styles.privacyRow}>
            <SymbolView name="calendar" size={19} weight="semibold" tintColor="#0A84FF" />
            <Text style={styles.privacyText}>Sidekick keeps at most 30 days of daily summaries.</Text>
          </View>
          <View style={styles.privacyRow}>
            <SymbolView name="sparkles" size={19} weight="semibold" tintColor="#0A84FF" />
            <Text style={styles.privacyText}>
              Those summaries are stored by Sidekick and processed with its AI provider for personalized support.
            </Text>
          </View>
          <View style={styles.privacyRow}>
            <SymbolView name="nosign" size={19} weight="semibold" tintColor="#0A84FF" />
            <Text style={styles.privacyText}>Health data is never used for ads or marketing profiles.</Text>
          </View>
          <View style={styles.privacyRow}>
            <SymbolView name="trash.fill" size={19} weight="semibold" tintColor="#0A84FF" />
            <Text style={styles.privacyText}>Disconnecting stops uploads and deletes Sidekick’s copy.</Text>
          </View>
        </View>

        {connected ? (
          <View>
            <Pressable
              disabled={refresh.isPending}
              style={[styles.refreshButton, refresh.isPending ? styles.actionPending : null]}
              onPress={() => refresh.mutate()}
            >
              <SymbolView name="arrow.clockwise" size={16} weight="semibold" tintColor="#0A84FF" />
              <Text style={styles.manageText}>
                {refresh.isPending ? "Refreshing…" : "Refresh summaries"}
              </Text>
            </Pressable>
            <Pressable style={styles.manageButton} onPress={() => void openHealthApp()}>
              <Text style={styles.manageText}>Manage access in Health</Text>
              <SymbolView name="arrow.up.forward" size={15} weight="semibold" tintColor="#0A84FF" />
            </Pressable>
            <Pressable style={styles.disconnectButton} onPress={confirmDisconnect}>
              <Text style={styles.disconnectText}>
                {disconnect.isError ? "Delete stored summaries" : "Disconnect & Delete"}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      {!connected ? (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <PrimaryButton
            label="Connect & Share Summaries"
            disabled={!healthAvailable() || connection.isPending}
            loading={connect.isPending}
            onPress={() => connect.mutate()}
          />
          <Text style={styles.consentCaption}>
            Continuing requests Apple Health access and turns on AI sharing for the selected summaries.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F2F2F7" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 10 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#000000" },
  content: { paddingHorizontal: 20, paddingTop: 10 },
  heroIcon: { width: 84, height: 84, borderRadius: 26, borderCurve: "continuous", backgroundColor: "#FFE8EE", alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 14 },
  title: { fontSize: 28, lineHeight: 33, letterSpacing: -0.5, fontWeight: "800", color: "#000000", textAlign: "center", marginTop: 18 },
  body: { fontSize: 15, lineHeight: 22, color: "#636366", textAlign: "center", marginTop: 8 },
  groupLabel: { fontSize: 13, color: "#8E8E93", marginLeft: 4, marginTop: 22, marginBottom: 8 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 16, borderCurve: "continuous", overflow: "hidden" },
  metric: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14 },
  metricIcon: { width: 38, height: 38, borderRadius: 12, borderCurve: "continuous", backgroundColor: "#FFE8EE", alignItems: "center", justifyContent: "center" },
  metricCopy: { flex: 1 },
  metricTitle: { fontSize: 16, fontWeight: "600", color: "#1C1C1E" },
  metricDetail: { fontSize: 13, color: "#8E8E93", marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "#D1D1D6", marginLeft: 64 },
  privacyCard: { backgroundColor: "#E5F2FF", borderRadius: 16, borderCurve: "continuous", padding: 16, gap: 16 },
  privacyRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  privacyText: { flex: 1, fontSize: 14, lineHeight: 19, color: "#285A8C" },
  statusCard: { backgroundColor: "#FFFFFF", borderRadius: 16, borderCurve: "continuous", marginTop: 22, padding: 16 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#30D158" },
  statusCopy: { flex: 1 },
  statusTitle: { fontSize: 16, fontWeight: "700", color: "#1C1C1E" },
  statusDetail: { fontSize: 13, color: "#8E8E93", marginTop: 3 },
  manageButton: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 20 },
  refreshButton: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 20, backgroundColor: "#FFFFFF", borderRadius: 14, borderCurve: "continuous" },
  manageText: { fontSize: 16, fontWeight: "600", color: "#0A84FF" },
  disconnectButton: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: "#FF3B30", alignItems: "center", justifyContent: "center" },
  disconnectText: { fontSize: 16, fontWeight: "600", color: "#FF3B30" },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "rgba(242,242,247,0.96)", paddingHorizontal: 20, paddingTop: 12 },
  consentCaption: { fontSize: 11, lineHeight: 15, color: "#8E8E93", textAlign: "center", marginTop: 7 },
  actionPending: { opacity: 0.45 },
});
