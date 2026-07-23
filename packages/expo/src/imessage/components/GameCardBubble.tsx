import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSidekickDisplayName } from "../../lib/sidekick-name";
import { colors, font } from "../theme";
import type { GameCard, GameType } from "../types";

/**
 * A game turn card (plan 21 §Chat surface), GamePigeon-style. The match's
 * latest row renders the full 250pt app-message card (RN-View mini thumbnail +
 * name/status strip); older rows collapse to a compact non-pressable pill so
 * the transcript reads like a played match without stale full-size cards.
 * Tapbacks and swipe-reply stay row-level — this component only claims the tap.
 */

const GLYPHS: Record<GameType, string> = { eight_ball: "🎱", cup_pong: "🏓" };
const NAMES: Record<GameType, string> = { eight_ball: "8 Ball", cup_pong: "Cup Pong" };

export function gameName(gameType: GameType): string {
	return NAMES[gameType];
}

function statusLine(game: GameCard, sidekickName: string): string {
	if (game.winner === "user") {
		return "You won";
	}
	if (game.winner === "sidekick") {
		return `${sidekickName} wins`;
	}
	if (game.status === "expired") {
		return "Expired";
	}
	if (game.yourMove) {
		return "Your move";
	}
	return "Waiting…";
}

/** Cup rows for the rack tier a count implies (mirrors core's re-rack tiers). */
function cupRows(count: number): number[] {
	if (count >= 7) {
		return [4, 3, 2, 1];
	}
	if (count >= 4) {
		return [3, 2, 1];
	}
	return [2, 1];
}

/** The 4-3-2-1 cup triangle, `count` cups standing, back row first. */
export function MiniCupRack({ count, cupSize }: { count: number; cupSize: number }) {
	let remaining = count;
	return (
		<View style={miniStyles.rack}>
			{cupRows(count).map((rowSize, row) => {
				const inRow = Math.min(remaining, rowSize);
				remaining -= inRow;
				return (
					<View key={row} style={miniStyles.cupRow}>
						{Array.from({ length: inRow }, (_, i) => (
							<View
								key={i}
								style={[
									miniStyles.cup,
									{ width: cupSize, height: cupSize, borderRadius: cupSize / 2 },
								]}
							/>
						))}
					</View>
				);
			})}
		</View>
	);
}

const POOL_DOTS = ["#F5B800", "#1B54C4", "#D22B2B", "#5A2D82", "#E8762C", "#1E7A38"];

/** Green felt with a scatter of ball dots — the pool thumbnail, no GL. */
export function MiniPoolTable({ width, height }: { width: number; height: number }) {
	return (
		<View style={[miniStyles.felt, { width, height }]}>
			{POOL_DOTS.map((color, i) => (
				<View
					key={color}
					style={[
						miniStyles.poolDot,
						{
							backgroundColor: color,
							left: width * (0.18 + 0.13 * i),
							top: height * (i % 2 === 0 ? 0.28 : 0.55),
						},
					]}
				/>
			))}
			<View style={[miniStyles.poolDot, miniStyles.cueDot, { left: width * 0.46, top: height * 0.78 }]} />
		</View>
	);
}

function Thumbnail({ game }: { game: GameCard }) {
	if (game.gameType === "cup_pong") {
		return (
			<View style={styles.thumbCupPong}>
				<MiniCupRack count={game.summary.cupsLeft?.sidekick ?? 10} cupSize={22} />
			</View>
		);
	}
	return (
		<View style={styles.thumbPool}>
			<MiniPoolTable width={190} height={92} />
		</View>
	);
}

export function GameCardBubble({
	game,
	onOpenGame,
}: {
	game: GameCard;
	onOpenGame?: (matchId: string) => void;
}) {
	const [pressed, setPressed] = useState(false);
	const sidekickName = useSidekickDisplayName();
	if (!game.latest) {
		return (
			<View style={styles.pill}>
				<Text style={styles.pillGlyph}>{GLYPHS[game.gameType]}</Text>
				<Text style={styles.pillText}>{NAMES[game.gameType]}</Text>
			</View>
		);
	}
	const finished = game.status === "complete" || game.status === "resigned";
	const pressable = onOpenGame !== undefined && (game.yourMove || finished);
	return (
		<Pressable
			disabled={!pressable}
			onPressIn={() => setPressed(true)}
			onPressOut={() => setPressed(false)}
			onPress={() => onOpenGame?.(game.matchId)}
			style={[styles.card, pressed ? styles.cardPressed : null]}
		>
			<Thumbnail game={game} />
			<View style={styles.strip}>
				<Text style={styles.stripGlyph}>{GLYPHS[game.gameType]}</Text>
				<View style={styles.stripText}>
					<Text style={styles.name}>{NAMES[game.gameType]}</Text>
					<Text style={styles.status}>{statusLine(game, sidekickName)}</Text>
				</View>
			</View>
		</Pressable>
	);
}

const miniStyles = StyleSheet.create({
	rack: {
		alignItems: "center",
		gap: 3,
	},
	cupRow: {
		flexDirection: "row",
		gap: 4,
	},
	cup: {
		backgroundColor: "#E0463C",
		borderWidth: 2,
		borderColor: "#F2726A",
	},
	felt: {
		backgroundColor: "#2E8B4A",
		borderRadius: 12,
		borderCurve: "continuous",
		borderWidth: 4,
		borderColor: "#7A4E2A",
		overflow: "hidden",
	},
	poolDot: {
		position: "absolute",
		width: 12,
		height: 12,
		borderRadius: 6,
	},
	cueDot: {
		backgroundColor: "#FFFFFF",
	},
});

const styles = StyleSheet.create({
	card: {
		width: 250,
		borderRadius: 18,
		borderCurve: "continuous",
		backgroundColor: colors.gray6,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.gray4,
		overflow: "hidden",
	},
	cardPressed: {
		opacity: 0.7,
	},
	thumbCupPong: {
		height: 124,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#F3E3C9",
	},
	thumbPool: {
		height: 124,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#DCE8DD",
	},
	strip: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		paddingHorizontal: 12,
		paddingVertical: 9,
		backgroundColor: colors.background,
	},
	stripGlyph: {
		fontSize: 24,
	},
	stripText: {
		flex: 1,
	},
	name: {
		fontSize: 15,
		fontFamily: font.medium,
		color: colors.label,
	},
	status: {
		fontSize: 13,
		fontFamily: font.regular,
		color: colors.secondaryLabel,
		marginTop: 1,
	},
	pill: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		paddingHorizontal: 12,
		paddingVertical: 7,
		borderRadius: 16,
		borderCurve: "continuous",
		backgroundColor: colors.gray6,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.gray4,
	},
	pillGlyph: {
		fontSize: 15,
	},
	pillText: {
		fontSize: 15,
		fontFamily: font.regular,
		color: colors.secondaryLabel,
	},
});
