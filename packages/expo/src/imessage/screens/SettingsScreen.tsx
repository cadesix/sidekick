import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { GlassView } from "expo-glass-effect";
import { SymbolView } from "expo-symbols";
import { type ReactNode, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trpc } from "~/lib/api";
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

function Group({ title, children }: { title: string; children: ReactNode }) {
	return (
		<View style={styles.group}>
			<Text style={styles.groupTitle}>{title}</Text>
			<View style={styles.card}>{children}</View>
		</View>
	);
}

export function SettingsScreen() {
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const queryClient = useQueryClient();
	const me = useQuery({ queryKey: ["me"], queryFn: () => trpc.users.me.query() });

	const save = useMutation({
		mutationFn: (patch: { name?: string; sidekickName?: string }) =>
			trpc.users.updateProfile.mutate(patch),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
	});

	return (
		<View style={styles.screen}>
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
	divider: {
		height: StyleSheet.hairlineWidth,
		backgroundColor: colors.gray3,
		marginLeft: 16,
	},
});
