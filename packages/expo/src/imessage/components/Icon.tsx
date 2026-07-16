import { SymbolView, type SFSymbol, type SymbolWeight } from "expo-symbols";
import {
	ArrowUp,
	AudioLines,
	Camera,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	CircleEllipsis,
	Copy,
	Heart,
	Image,
	Languages,
	MapPin,
	MoreHorizontal,
	Pause,
	Play,
	Plus,
	Reply,
	ShieldHalf,
	Smile,
	TextSelect,
	ThumbsDown,
	ThumbsUp,
	Undo2,
	X,
} from "lucide-react-native";

// Each glyph maps to its SF Symbol (iOS) and a Lucide component (web/Android
// fallback). `sfFilled` is the `.fill` SF variant for glyphs the reference draws
// solid (play/pause, tapback art, swipe-reply arrow). SF names are typed as
// SFSymbol so a typo fails the build.
const GLYPHS = {
	arrowUp: { sf: "arrow.up", Lucide: ArrowUp },
	audio: { sf: "waveform", Lucide: AudioLines },
	camera: { sf: "camera", Lucide: Camera },
	chevronDown: { sf: "chevron.down", Lucide: ChevronDown },
	chevronLeft: { sf: "chevron.left", Lucide: ChevronLeft },
	chevronRight: { sf: "chevron.right", Lucide: ChevronRight },
	copy: { sf: "doc.on.doc", Lucide: Copy },
	ellipsis: { sf: "ellipsis", Lucide: MoreHorizontal },
	heart: { sf: "heart", sfFilled: "heart.fill", Lucide: Heart },
	location: { sf: "location", Lucide: MapPin },
	more: { sf: "ellipsis.circle", Lucide: CircleEllipsis },
	pause: { sf: "pause", sfFilled: "pause.fill", Lucide: Pause },
	photo: { sf: "photo", Lucide: Image },
	play: { sf: "play", sfFilled: "play.fill", Lucide: Play },
	plus: { sf: "plus", Lucide: Plus },
	reply: { sf: "arrowshape.turn.up.left", sfFilled: "arrowshape.turn.up.left.fill", Lucide: Reply },
	select: { sf: "selection.pin.in.out", Lucide: TextSelect },
	shield: { sf: "shield", Lucide: ShieldHalf },
	smile: { sf: "face.smiling", Lucide: Smile },
	thumbsDown: { sf: "hand.thumbsdown", sfFilled: "hand.thumbsdown.fill", Lucide: ThumbsDown },
	thumbsUp: { sf: "hand.thumbsup", sfFilled: "hand.thumbsup.fill", Lucide: ThumbsUp },
	translate: { sf: "translate", Lucide: Languages },
	undo: { sf: "arrow.uturn.backward", Lucide: Undo2 },
	xmark: { sf: "xmark", Lucide: X },
} as const satisfies Record<string, { sf: SFSymbol; sfFilled?: SFSymbol; Lucide: typeof Plus }>;

export type IconName = keyof typeof GLYPHS;

function weightForStroke(strokeWidth: number): SymbolWeight {
	if (strokeWidth >= 3) {
		return "bold";
	}
	if (strokeWidth >= 2.5) {
		return "semibold";
	}
	return "medium";
}

/**
 * Native SF Symbol on iOS; the equivalent Lucide glyph as the web/Android
 * fallback (SymbolView renders `fallback` off-iOS). `filled` selects the `.fill`
 * SF variant / paints the Lucide glyph solid.
 */
export function Icon({
	name,
	size,
	color,
	filled = false,
	strokeWidth = 2,
}: {
	name: IconName;
	size: number;
	color: string;
	filled?: boolean;
	strokeWidth?: number;
}) {
	const glyph = GLYPHS[name];
	const sfName = filled && "sfFilled" in glyph ? glyph.sfFilled : glyph.sf;
	const Lucide = glyph.Lucide;
	return (
		<SymbolView
			name={sfName}
			size={size}
			tintColor={color}
			weight={weightForStroke(strokeWidth)}
			fallback={
				<Lucide size={size} color={color} fill={filled ? color : "none"} strokeWidth={strokeWidth} />
			}
		/>
	);
}
