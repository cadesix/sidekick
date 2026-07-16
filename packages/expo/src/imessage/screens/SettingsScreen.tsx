import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
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
import { useSignOut } from "~/lib/auth";
import { getLocalFocusSettings } from "~/lib/focus";
import { HEALTH_CONNECTION_QUERY_KEY, loadHealthConnection } from "~/lib/health-connection";
import {
	disableLocationAccess,
	enableLocationAccess,
	locationAccess,
} from "~/lib/location";
import { colors } from "../theme";
import { Glass } from "../components/Glass";
import { Icon, type IconName } from "../components/Icon";
import { enablePushNotifications } from "~/lib/notifications/registration";

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
				<Icon name="chevronRight" size={14} color={colors.gray3} strokeWidth={2.5} />
			</View>
		</Pressable>
	);
}

/** A read-only label/value row in the Account card, with its trailing divider. */
function AccountRow({ label, value }: { label: string; value: string }) {
	return (
		<>
			<View style={styles.row}>
				<Text style={styles.rowLabel}>{label}</Text>
				<Text style={styles.rowValue}>{value}</Text>
			</View>
			<View style={styles.divider} />
		</>
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
	icon: IconName;
	iconColor: string;
	iconBackground: string;
	title: string;
	description: string;
	onPress: () => void;
}) {
	return (
		<Pressable style={styles.integrationRow} onPress={onPress}>
			<View style={[styles.integrationIcon, { backgroundColor: iconBackground }]}>
				<Icon name={icon} size={21} color={iconColor} filled />
			</View>
			<View style={styles.integrationCopy}>
				<Text style={styles.rowLabel}>{title}</Text>
				<Text style={styles.integrationDescription}>{description}</Text>
			</View>
			<Icon name="chevronRight" size={14} color={colors.gray3} strokeWidth={2.5} />
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
	const notifications = useQuery({
		queryKey: ["notifications", "preferences"],
		queryFn: () => trpc.notifications.preferences.query(),
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

	const updateNotifications = useMutation({
		mutationFn: async (patch: {
			proactiveEnabled?: boolean;
			checkinsEnabled?: boolean;
			remindersEnabled?: boolean;
			awakeStart?: string;
			awakeEnd?: string;
		}) => {
			await trpc.notifications.updatePreferences.mutate(patch);
			if (patch.proactiveEnabled) {
				try {
					const enabled = await enablePushNotifications();
					if (!enabled) {
						Alert.alert(
							"Notifications are off",
							"Sidekick can still leave messages in chat. You can turn alerts on in iOS Settings.",
							[
								{ text: "Not now", style: "cancel" },
								{ text: "Open Settings", onPress: () => void Linking.openSettings() },
							],
						);
					}
				} catch {
					Alert.alert(
						"Couldn’t register this device",
						"Your preference was saved. Sidekick will try notifications again when the app reconnects.",
					);
				}
			}
		},
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: ["notifications", "preferences"] }),
	});

	const signOut = useSignOut();
	const signOutMutation = useMutation({ mutationFn: signOut });

	const locationEnabled = location.data?.access.enabled ?? false;

	return (
		<View style={styles.screen}>
			<StatusBar style="dark" />
			<View style={styles.header}>
				<Glass isInteractive style={styles.glassButton}>
					<Pressable hitSlop={12} onPress={() => router.back()} style={styles.glassPressable}>
						<Icon name="chevronLeft" size={20} color={colors.blue} strokeWidth={2.5} />
					</Pressable>
				</Glass>
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
					{notifications.data ? (
						<Group
							title="Notifications"
							footer="Proactive messages wait until you’ve been away for 12 hours and arrive at a varied time inside your awake window."
						>
							<View style={styles.row}>
								<Text style={styles.rowLabel}>Messages from Sidekick</Text>
								<Switch
									style={styles.switch}
									value={notifications.data.proactiveEnabled}
									disabled={updateNotifications.isPending}
									onValueChange={(proactiveEnabled) =>
										updateNotifications.mutate({ proactiveEnabled })
									}
									trackColor={{ false: colors.gray4, true: colors.green }}
								/>
							</View>
							<View style={styles.divider} />
							<View style={styles.row}>
								<Text style={styles.rowLabel}>Goal check-ins</Text>
								<Switch
									style={styles.switch}
									value={notifications.data.checkinsEnabled}
									disabled={updateNotifications.isPending}
									onValueChange={(checkinsEnabled) =>
										updateNotifications.mutate({ checkinsEnabled })
									}
									trackColor={{ false: colors.gray4, true: colors.green }}
								/>
							</View>
							<View style={styles.divider} />
							<View style={styles.row}>
								<Text style={styles.rowLabel}>Reminders</Text>
								<Switch
									style={styles.switch}
									value={notifications.data.remindersEnabled}
									disabled={updateNotifications.isPending}
									onValueChange={(remindersEnabled) =>
										updateNotifications.mutate({ remindersEnabled })
									}
									trackColor={{ false: colors.gray4, true: colors.green }}
								/>
							</View>
							<View style={styles.divider} />
							<Field
								label="Awake from"
								value={notifications.data.awakeStart}
								placeholder="09:00"
								onCommit={(awakeStart) => updateNotifications.mutate({ awakeStart })}
							/>
							<View style={styles.divider} />
							<Field
								label="Until"
								value={notifications.data.awakeEnd}
								placeholder="21:30"
								onCommit={(awakeEnd) => updateNotifications.mutate({ awakeEnd })}
							/>
						</Group>
					) : null}
					<Group
						title="Connected"
						footer="Each connection explains what stays on your iPhone and what Sidekick can use. You can review or disconnect it anytime."
					>
						<View style={styles.integrationRow}>
							<View style={styles.integrationIcon}>
								<Icon name="location" size={21} color="#FFFFFF" filled />
							</View>
							<View style={styles.integrationCopy}>
								<Text style={styles.rowLabel}>Location</Text>
								<Text style={styles.integrationDescription}>{locationDescription(location.data)}</Text>
							</View>
							<Switch
								style={styles.switch}
								value={locationEnabled}
								disabled={location.isPending || setLocationEnabled.isPending}
								onValueChange={(enabled) => setLocationEnabled.mutate(enabled)}
								trackColor={{ false: colors.gray4, true: colors.green }}
							/>
						</View>
						<View style={styles.integrationDivider} />
						<IntegrationLinkRow
							icon="shield"
							iconColor={colors.blue}
							iconBackground="#E5F2FF"
							title="Focus"
							description={focusDescription(focus.data)}
							onPress={() => router.push("/focus-setup")}
						/>
						<View style={styles.integrationDivider} />
						<IntegrationLinkRow
							icon="heart"
							iconColor="#FF375F"
							iconBackground="#FFE8EE"
							title="Apple Health"
							description={healthDescription(health.data)}
							onPress={() => router.push("../health-setup")}
						/>
					</Group>
					<Group title="Account">
						{me.data.email ? <AccountRow label="Email" value={me.data.email} /> : null}
						{me.data.phone ? <AccountRow label="Phone" value={me.data.phone} /> : null}
						<Pressable
							style={styles.row}
							disabled={signOutMutation.isPending}
							onPress={() => signOutMutation.mutate()}
						>
							<Text style={styles.signOutLabel}>
								{signOutMutation.isPending ? "Signing out…" : "Sign out"}
							</Text>
						</Pressable>
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
		// Fixed padding, not insets.top: this screen always presents as a modal
		// sheet, which starts below the status bar (the root window inset would
		// double up as a huge blank band).
		paddingTop: 12,
		paddingBottom: 10,
	},
	glassButton: {
		width: 42,
		height: 42,
		borderRadius: 21,
		borderCurve: "continuous",
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
		// HIG: the label leads, the control (switch/value) sits at the trailing edge
		justifyContent: "space-between",
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
	signOutLabel: {
		fontSize: 17,
		color: colors.red,
	},
	// Without this the iOS 26 switch stretches to the row height and draws its
	// track top-anchored, so it sits visibly above the label's centerline.
	switch: {
		alignSelf: "center",
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
