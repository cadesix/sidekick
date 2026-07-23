import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "~/components/BottomSheet";
import { trpc } from "~/lib/api";
import { colors, font } from "../theme";
import type { GameType } from "../types";
import { MiniCupRack, MiniPoolTable } from "./GameCardBubble";

/**
 * The `+` drawer's game picker (plan 21 §Chat surface): two big tiles with
 * RN-View mini art and the lifetime record beneath. Picking one calls
 * `games.create` (the sidekick has already thrown) and hands the new match to
 * the host, which opens the overlay.
 */

function recordLine(record: { user: number; sidekick: number } | undefined): string {
	if (!record || (record.user === 0 && record.sidekick === 0)) {
		return "No games yet";
	}
	return `${record.user}–${record.sidekick}`;
}

function GameTile({
	name,
	record,
	disabled,
	onPress,
	children,
}: {
	name: string;
	record: string;
	disabled: boolean;
	onPress: () => void;
	children: ReactNode;
}) {
	const [pressed, setPressed] = useState(false);
	return (
		<Pressable
			disabled={disabled}
			onPressIn={() => setPressed(true)}
			onPressOut={() => setPressed(false)}
			onPress={onPress}
			style={[styles.tile, pressed ? styles.tilePressed : null, disabled ? styles.tileDisabled : null]}
		>
			<View style={styles.tileArt}>{children}</View>
			<Text style={styles.tileName}>{name}</Text>
			<Text style={styles.tileRecord}>{record}</Text>
		</Pressable>
	);
}

export function GamePickerSheet({
	visible,
	onClose,
	onOpenMatch,
}: {
	visible: boolean;
	onClose: () => void;
	onOpenMatch: (matchId: string) => void;
}) {
	const record = useQuery({
		queryKey: ["games", "record"],
		queryFn: () => trpc.games.record.query(),
		enabled: visible,
	});
	const create = useMutation({
		mutationFn: (gameType: GameType) => trpc.games.create.mutate({ gameType }),
		onSuccess: (match) => onOpenMatch(match.matchId),
	});
	return (
		<BottomSheet visible={visible} onClose={onClose}>
			<Text style={styles.title}>Games</Text>
			<View style={styles.tiles}>
				<GameTile
					name="Cup Pong"
					record={recordLine(record.data?.cup_pong)}
					disabled={create.isPending}
					onPress={() => create.mutate("cup_pong")}
				>
					<MiniCupRack count={10} cupSize={16} />
				</GameTile>
				<GameTile
					name="8 Ball"
					record={recordLine(record.data?.eight_ball)}
					disabled={create.isPending}
					onPress={() => create.mutate("eight_ball")}
				>
					<MiniPoolTable width={110} height={64} />
				</GameTile>
			</View>
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	title: {
		fontSize: 20,
		fontFamily: font.bold,
		color: colors.label,
		textAlign: "center",
		marginBottom: 14,
	},
	tiles: {
		flexDirection: "row",
		gap: 12,
	},
	tile: {
		flex: 1,
		alignItems: "center",
		paddingVertical: 16,
		borderRadius: 20,
		borderCurve: "continuous",
		backgroundColor: colors.gray6,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.gray4,
	},
	tilePressed: {
		opacity: 0.7,
	},
	tileDisabled: {
		opacity: 0.55,
	},
	tileArt: {
		height: 80,
		justifyContent: "center",
	},
	tileName: {
		fontSize: 16,
		fontFamily: font.medium,
		color: colors.label,
		marginTop: 8,
	},
	tileRecord: {
		fontSize: 13,
		fontFamily: font.regular,
		color: colors.secondaryLabel,
		marginTop: 2,
	},
});
