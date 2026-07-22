import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useState } from "react";
import {
	Alert,
	Image,
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
import { BOND_MIN } from "@sidekick/core";
import { StreakModal } from "~/components/StreakModal";
import { locationStatus, trpc } from "~/lib/api";
import { useSignOut } from "~/lib/auth";
import { useSnapshot } from "~/lib/state";
import { INK } from "~/lib/tokens";
import { getLocalFocusSettings } from "~/lib/focus";
import { HEALTH_CONNECTION_QUERY_KEY, loadHealthConnection } from "~/lib/health-connection";
import { sidekickDisplayName } from "~/lib/sidekick-name";
import {
	disableLocationAccess,
	enableLocationAccess,
	locationAccess,
} from "~/lib/location";
import { colors } from "../theme";
import { Glass } from "../components/Glass";
import { Icon, type IconName } from "../components/Icon";
const STREAK_ICON = require("../../../assets/icons/streak.png");

// design-system type (06 §1.2): one family, ABC Diatype Rounded — iOS won't
// faux-bold it, so weights are separate families
const FONT = "Diatype-Rounded";
const FONT_MEDIUM = "Diatype-Rounded-Medium";
const FONT_BOLD = "Diatype-Rounded-Bold";
const INK_55 = "rgba(17,17,17,0.55)";
const INK_45 = "rgba(17,17,17,0.45)";
const INK_12 = "rgba(17,17,17,0.12)";

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
			{/* strokeless card on the app's hard bottom shadow (grey, centered,
			    zero blur — the onboarding/shop squishy-card recipe) */}
			<View style={styles.card}>{children}</View>
			{footer ? <Text style={styles.groupFooter}>{footer}</Text> : null}
		</View>
	);
}

async function loadLocationSetting() {
	const [access, status] = await Promise.all([locationAccess(), locationStatus()]);
	return { access, status };
}

function locationDescription(
	setting: Awaited<ReturnType<typeof loadLocationSetting>> | undefined,
	sidekickName: string,
): string {
	if (!setting?.access.enabled) {
		return "Share your city for nearby ideas and local context";
	}
	if (setting.status.city) {
		return `Sharing ${setting.status.city} with ${sidekickName}`;
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

export function ProfileScreen() {
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const queryClient = useQueryClient();
	const me = useQuery({ queryKey: ["me"], queryFn: () => trpc.users.me.query() });
	// the latest astral card, bond and streak — all server-owned snapshot slices
	const snapshot = useSnapshot().data;
	const astral = snapshot?.astral ?? null;
	const bond = snapshot?.bond ?? BOND_MIN;
	const streakCount = snapshot?.streak.count ?? 0;
	const [streakOpen, setStreakOpen] = useState(false);
	const location = useQuery({ queryKey: ["location", "setting"], queryFn: loadLocationSetting });
	const focus = useQuery({ queryKey: ["focus-local"], queryFn: getLocalFocusSettings });
	const health = useQuery({
		queryKey: HEALTH_CONNECTION_QUERY_KEY,
		queryFn: loadHealthConnection,
	});
	// the character's name (bracketed diagnostic) — used in persona copy below;
	// the iOS-Settings app-name reference stays the literal "Sidekick" brand
	const sidekickName = sidekickDisplayName(me.data?.sidekickName);

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
				<Text style={styles.title}>Profile</Text>
				<View style={styles.glassButton} />
			</View>

			{me.data ? (
				<ScrollView
					contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
					keyboardDismissMode="on-drag"
				>
					{/* your name, big at the top — edited via the You group below */}
					<Text style={styles.profileName}>{me.data.name ?? "You"}</Text>

					{/* headline stats: the bond score, large, plus the streak (moved
					    here from the home top-right; taps open the milestone ladder) */}
					<View style={styles.statsRow}>
						<View style={[styles.card, styles.statCard]}>
							<Text style={styles.statValue}>
								<Text style={styles.statStar}>✦ </Text>
								{bond}%
							</Text>
							<Text style={styles.statCaption}>bond</Text>
						</View>
						<Pressable style={[styles.card, styles.statCard]} onPress={() => setStreakOpen(true)}>
							<View style={styles.statValueRow}>
								<Image source={STREAK_ICON} style={styles.statIcon} />
								<Text style={styles.statValue}>{streakCount}</Text>
							</View>
							<Text style={styles.statCaption}>day streak</Text>
						</Pressable>
					</View>

					{/* the latest astral card — same dark-purple treatment as the
					    star-chat reveal, compact; a nudge toward a first star chat
					    until a card exists */}
					<View style={[styles.card, styles.astralCard]}>
						<View style={styles.astralLabelRow}>
							<Text style={styles.astralStar}>✦</Text>
							<Text style={styles.astralLabel}>your astral card</Text>
						</View>
						{astral ? (
							<>
								<Text style={styles.astralArchetype}>{astral.archetype}</Text>
								{astral.traits.length ? (
									<View style={styles.astralTraits}>
										{astral.traits.map((tr, i) => (
											<View key={i} style={styles.astralChip}>
												<Text style={styles.astralChipText}>{tr}</Text>
											</View>
										))}
									</View>
								) : null}
								<Text style={styles.astralReading}>{astral.reading}</Text>
							</>
						) : (
							<Text style={styles.astralReading}>
								Do an astral chat with {sidekickName} to reveal your card.
							</Text>
						)}
					</View>

					<Group title="You">
						<Field
							label="Name"
							value={me.data.name ?? ""}
							placeholder="Your name"
							onCommit={(name) => save.mutate({ name })}
						/>
					</Group>
					<Group title={sidekickName}>
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
						footer={`Each connection explains what stays on your iPhone and what ${sidekickName} can use. You can review or disconnect it anytime.`}
					>
						<View style={styles.integrationRow}>
							<View style={styles.integrationIcon}>
								<Icon name="location" size={21} color="#FFFFFF" filled />
							</View>
							<View style={styles.integrationCopy}>
								<Text style={styles.rowLabel}>Location</Text>
								<Text style={styles.integrationDescription}>{locationDescription(location.data, sidekickName)}</Text>
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
							<LinkRow label="Face sheet" onPress={() => router.push("/dev/face-sheet")} />
						</Group>
					) : null}
				</ScrollView>
			) : null}

			{/* streak milestone ladder — opened from the streak stat card */}
			<StreakModal open={streakOpen} onClose={() => setStreakOpen(false)} />
		</View>
	);
}

const styles = StyleSheet.create({
	screen: {
		flex: 1,
		backgroundColor: "#FFFFFF", // design system: the app background is always white
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
		fontFamily: FONT_BOLD,
		fontSize: 17,
		color: INK,
	},
	content: {
		paddingHorizontal: 20, // screen gutter (06 §1.3)
	},
	// heading role: 27/800, −0.02em tracking
	profileName: {
		marginTop: 18,
		fontFamily: FONT_BOLD,
		fontSize: 27,
		letterSpacing: -0.54,
		textAlign: "center",
		color: INK,
	},
	// the app's card surface: strokeless, on the hard bottom shadow used by the
	// onboarding option cards / shop buttons — light grey, x-centered, zero blur
	card: {
		backgroundColor: "#FFFFFF",
		borderRadius: 16,
		borderCurve: "continuous",
		shadowColor: "#c4c4c4",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 1,
		shadowRadius: 0,
		elevation: 3,
	},
	statsRow: {
		marginTop: 16,
		flexDirection: "row",
		gap: 10,
	},
	statCard: {
		flex: 1,
		alignItems: "center",
		paddingVertical: 16,
		gap: 2,
	},
	statValueRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
	},
	statValue: {
		fontFamily: FONT_BOLD,
		fontSize: 34,
		lineHeight: 40,
		color: INK,
	},
	statStar: {
		fontSize: 22,
		color: "#7A5AF8",
	},
	statIcon: {
		width: 30,
		height: 30,
		resizeMode: "contain",
	},
	statCaption: {
		fontFamily: FONT_MEDIUM,
		fontSize: 12,
		textTransform: "uppercase",
		letterSpacing: 0.6,
		color: INK_45,
	},
	// compact take on the star-chat reveal card (same palette), on the shared
	// card shadow; its dark fill overrides the card's white
	astralCard: {
		marginTop: 16,
		backgroundColor: "#160e2c",
		padding: 20,
	},
	astralLabelRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
	},
	astralStar: {
		fontSize: 12,
		color: "#C9BCFF",
	},
	astralLabel: {
		fontFamily: FONT_BOLD,
		fontSize: 11,
		textTransform: "uppercase",
		letterSpacing: 2,
		color: "#C9BCFF",
	},
	astralArchetype: {
		marginTop: 8,
		fontFamily: FONT_BOLD,
		fontSize: 24,
		lineHeight: 28,
		color: "#FFFFFF",
	},
	astralTraits: {
		marginTop: 10,
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 6,
	},
	astralChip: {
		borderRadius: 999,
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.1)",
		backgroundColor: "rgba(255,255,255,0.1)",
		paddingHorizontal: 10,
		paddingVertical: 4,
	},
	astralChipText: {
		fontFamily: FONT_MEDIUM,
		fontSize: 12,
		color: "#E7E0FF",
	},
	astralReading: {
		marginTop: 12,
		fontFamily: FONT,
		fontSize: 14,
		lineHeight: 21,
		color: "rgba(231,224,255,0.9)",
	},
	group: {
		marginTop: 22,
	},
	groupTitle: {
		fontFamily: FONT_MEDIUM,
		fontSize: 12,
		textTransform: "uppercase",
		letterSpacing: 0.6,
		color: INK_45,
		marginBottom: 8,
		marginLeft: 4,
	},
	groupFooter: {
		fontFamily: FONT,
		fontSize: 13,
		lineHeight: 18,
		color: INK_45,
		marginTop: 10,
		marginHorizontal: 4,
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
		fontFamily: FONT,
		fontSize: 17,
		color: INK,
	},
	rowInput: {
		flex: 1,
		fontFamily: FONT,
		fontSize: 17,
		color: INK_55,
		textAlign: "right",
	},
	rowValue: {
		flex: 1,
		fontFamily: FONT,
		fontSize: 17,
		color: INK_55,
		textAlign: "right",
	},
	rowChevron: {
		flex: 1,
		alignItems: "flex-end",
	},
	signOutLabel: {
		fontFamily: FONT_MEDIUM,
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
		backgroundColor: INK_12,
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
		fontFamily: FONT,
		fontSize: 13,
		lineHeight: 17,
		color: INK_55,
	},
	integrationDivider: {
		height: StyleSheet.hairlineWidth,
		backgroundColor: INK_12,
		marginLeft: 66,
	},
});
