import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { GlassView } from "expo-glass-effect";
import { SymbolView } from "expo-symbols";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useState } from "react";
import {
	Alert,
	Linking,
	Pressable,
	ScrollView,
	StyleSheet,
	Switch,
	Text,
	TextInput,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { locationStatus, trpc } from "~/lib/api";
import { getLocalFocusSettings } from "~/lib/focus";
import { HEALTH_CONNECTION_QUERY_KEY, loadHealthConnection } from "~/lib/health-connection";
import {
	disableLocationAccess,
	enableLocationAccess,
	locationAccess,
} from "~/lib/location";
import { colors } from "../theme";

/** An iOS-style grouped field: label on the left, editable value on the right. */
function Field({
	label,
	value,
	placeholder,
	onCommit,
}: {
	label: string;
	value: string;
	placeholder: string;
	onCommit: (next: string) => void;
}) {
	const [draft, setDraft] = useState(value);
	const commit = () => {
		const next = draft.trim();
		if (next === "" || next === value) {
			setDraft(value);
			return;
		}
		onCommit(next);
	};

	return (
		<View style={styles.row}>
			<Text style={styles.rowLabel}>{label}</Text>
			<TextInput
				style={styles.rowInput}
				value={draft}
				placeholder={placeholder}
				placeholderTextColor={colors.gray2}
				returnKeyType="done"
				onChangeText={setDraft}
				onBlur={commit}
				onSubmitEditing={commit}
			/>
		</View>
	);
}

/** An iOS-style disclosure row that pushes another screen. */
function LinkRow({ label, onPress }: { label: string; onPress: () => void }) {
	return (
		<Pressable style={styles.row} onPress={onPress}>
			<Text style={styles.rowLabel}>{label}</Text>
			<View style={styles.rowChevron}>
				<SymbolView name="chevron.right" size={14} weight="semibold" tintColor={colors.gray3} />
			</View>
		</Pressable>
	);
}

function Group({
	title,
	children,
	footer,
}: {
	title: string;
	children: ReactNode;
	footer?: string;
}) {
	return (
		<View style={styles.group}>
			<Text style={styles.groupTitle}>{title}</Text>
			<View style={styles.card}>{children}</View>
			{footer ? <Text style={styles.groupFooter}>{footer}</Text> : null}
		</View>
	);
}

async function loadLocationSetting() {
	const [access, status] = await Promise.all([locationAccess(), locationStatus()]);
	return { access, status };
}

function locationDescription(setting: Awaited<ReturnType<typeof loadLocationSetting>> | undefined): string {
	if (!setting?.access.enabled) {
		return "Share your city for nearby ideas and local context";
	}
	if (setting.status.city) {
		return `Sharing ${setting.status.city} with your Sidekick`;
	}
	return "Finding your city…";
}

function focusDescription(setting: ReturnType<typeof getLocalFocusSettings> | undefined): string {
	if (!setting?.enabled) {
		return "Block distractions on this iPhone";
	}
	if (setting.mode === "daily" && setting.budgetMinutes !== null) {
		return `On · ${setting.budgetMinutes} min daily allowance`;
	}
	if (setting.mode === "scheduled") {
		return "On · scheduled locally";
	}
	return "On · whenever you ask";
}

function healthDescription(setting: Awaited<ReturnType<typeof loadHealthConnection>> | undefined): string {
	if (!setting?.sharingEnabled) {
		return "Share steps, sleep, workouts, and active energy";
	}
	if (setting.status?.lastSyncedAt) {
		return "Connected · up to 30 days of daily summaries";
	}
	return "Connected · waiting for available data";
}

function IntegrationLinkRow({
	icon,
	iconColor,
	iconBackground,
	title,
	description,
	onPress,
}: {
	icon: "shield.lefthalf.filled" | "heart.fill";
	iconColor: string;
	iconBackground: string;
	title: string;
	description: string;
	onPress: () => void;
}) {
	return (
		<Pressable style={styles.integrationRow} onPress={onPress}>
			<View style={[styles.integrationIcon, { backgroundColor: iconBackground }]}>
				<SymbolView name={icon} size={21} weight="semibold" tintColor={iconColor} />
			</View>
			<View style={styles.integrationCopy}>
				<Text style={styles.rowLabel}>{title}</Text>
				<Text style={styles.integrationDescription}>{description}</Text>
			</View>
			<SymbolView name="chevron.right" size={14} weight="semibold" tintColor={colors.gray3} />
		</Pressable>
	);
}

export function SettingsScreen() {
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const queryClient = useQueryClient();
	const me = useQuery({ queryKey: ["me"], queryFn: () => trpc.users.me.query() });
	const location = useQuery({ queryKey: ["location", "setting"], queryFn: loadLocationSetting });
	const focus = useQuery({ queryKey: ["focus-local"], queryFn: getLocalFocusSettings });
	const health = useQuery({
		queryKey: HEALTH_CONNECTION_QUERY_KEY,
		queryFn: loadHealthConnection,
	});

	const save = useMutation({
		mutationFn: (patch: { name?: string; sidekickName?: string }) =>
			trpc.users.updateProfile.mutate(patch),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
	});

	const setLocationEnabled = useMutation({
		mutationFn: async (enabled: boolean) => {
			if (!enabled) {
				await disableLocationAccess();
				return;
			}

			const access = await enableLocationAccess();
			if (!access.granted && !access.canAskAgain) {
				Alert.alert(
					"Location is off",
					"Turn on location for Sidekick in Settings, then try again.",
					[
						{ text: "Not now", style: "cancel" },
						{ text: "Open Settings", onPress: () => void Linking.openSettings() },
					],
				);
			}
		},
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: ["location", "setting"] });
		},
	});

	const locationEnabled = location.data?.access.enabled ?? false;

	return (
		<View style={styles.screen}>
			<StatusBar style="dark" />
			<View style={[styles.header, { paddingTop: insets.top + 6 }]}>
				<GlassView isInteractive glassEffectStyle="regular" style={styles.glassButton}>
					<Pressable hitSlop={12} onPress={() => router.back()} style={styles.glassPressable}>
						<SymbolView
							name="chevron.left"
							size={20}
							weight="semibold"
							tintColor={colors.blue}
						/>
					</Pressable>
				</GlassView>
				<Text style={styles.title}>Settings</Text>
				<View style={styles.glassButton} />
			</View>

			{me.data ? (
				<ScrollView
					contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
					keyboardDismissMode="on-drag"
				>
					<Group title="You">
						<Field
							label="Name"
							value={me.data.name ?? ""}
							placeholder="Your name"
							onCommit={(name) => save.mutate({ name })}
						/>
					</Group>
					<Group title="Sidekick">
						<Field
							label="Name"
							value={me.data.sidekickName ?? ""}
							placeholder="Sidekick"
							onCommit={(sidekickName) => save.mutate({ sidekickName })}
						/>
						<View style={styles.divider} />
						<View style={styles.row}>
							<Text style={styles.rowLabel}>Time zone</Text>
							<Text style={styles.rowValue}>{me.data.timezone ?? "—"}</Text>
						</View>
					</Group>
					<Group
						title="Connected"
						footer="Each connection explains what stays on your iPhone and what Sidekick can use. You can review or disconnect it anytime."
					>
						<View style={styles.integrationRow}>
							<View style={styles.integrationIcon}>
								<SymbolView name="location.fill" size={21} weight="semibold" tintColor="#FFFFFF" />
							</View>
							<View style={styles.integrationCopy}>
								<Text style={styles.rowLabel}>Location</Text>
								<Text style={styles.integrationDescription}>{locationDescription(location.data)}</Text>
							</View>
							<Switch
								value={locationEnabled}
								disabled={location.isPending || setLocationEnabled.isPending}
								onValueChange={(enabled) => setLocationEnabled.mutate(enabled)}
								trackColor={{ false: colors.gray4, true: colors.green }}
							/>
						</View>
						<View style={styles.integrationDivider} />
						<IntegrationLinkRow
							icon="shield.lefthalf.filled"
							iconColor={colors.blue}
							iconBackground="#E5F2FF"
							title="Focus"
							description={focusDescription(focus.data)}
							onPress={() => router.push("/focus-setup")}
						/>
						<View style={styles.integrationDivider} />
						<IntegrationLinkRow
							icon="heart.fill"
							iconColor="#FF375F"
							iconBackground="#FFE8EE"
							title="Apple Health"
							description={healthDescription(health.data)}
							onPress={() => router.push("../health-setup")}
						/>
					</Group>
					{__DEV__ ? (
						<Group title="Developer">
							<LinkRow label="Ad preview" onPress={() => router.push("/dev/ad-preview")} />
						</Group>
					) : null}
				</ScrollView>
			) : null}
		</View>
	);
}

const styles = StyleSheet.create({
	screen: {
		flex: 1,
		backgroundColor: colors.gray6,
	},
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 12,
		paddingBottom: 10,
	},
	glassButton: {
		width: 42,
		height: 42,
		borderRadius: 21,
	},
	glassPressable: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
	},
	title: {
		fontSize: 17,
		fontWeight: "700",
		color: colors.label,
	},
	content: {
		paddingHorizontal: 16,
	},
	group: {
		marginTop: 22,
	},
	groupTitle: {
		fontSize: 13,
		textTransform: "uppercase",
		letterSpacing: 0.4,
		color: colors.secondaryLabel,
		marginBottom: 8,
		marginLeft: 4,
	},
	groupFooter: {
		fontSize: 13,
		lineHeight: 18,
		color: colors.secondaryLabel,
		marginTop: 8,
		marginHorizontal: 4,
	},
	card: {
		backgroundColor: "#FFFFFF",
		borderRadius: 14,
		borderCurve: "continuous",
	},
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		paddingHorizontal: 16,
		height: 52,
	},
	rowLabel: {
		fontSize: 17,
		color: colors.label,
	},
	rowInput: {
		flex: 1,
		fontSize: 17,
		color: colors.secondaryLabel,
		textAlign: "right",
	},
	rowValue: {
		flex: 1,
		fontSize: 17,
		color: colors.secondaryLabel,
		textAlign: "right",
	},
	rowChevron: {
		flex: 1,
		alignItems: "flex-end",
	},
	divider: {
		height: StyleSheet.hairlineWidth,
		backgroundColor: colors.gray3,
		marginLeft: 16,
	},
	integrationRow: {
		minHeight: 76,
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		paddingHorizontal: 14,
		paddingVertical: 10,
	},
	integrationIcon: {
		width: 40,
		height: 40,
		borderRadius: 12,
		borderCurve: "continuous",
		backgroundColor: colors.blue,
		alignItems: "center",
		justifyContent: "center",
	},
	integrationCopy: {
		flex: 1,
		gap: 2,
	},
	integrationDescription: {
		fontSize: 13,
		lineHeight: 17,
		color: colors.secondaryLabel,
	},
	integrationDivider: {
		height: StyleSheet.hairlineWidth,
		backgroundColor: colors.gray3,
		marginLeft: 66,
	},
});
