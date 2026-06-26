import { APP_STORE_RATING, COLLECTOR_COUNT } from "./constants";
import { StarRating } from "./star-rating";

/** The "Rated 4.7 by N collectors" card. Horizontal by default; `vertical`
 * stacks the stars above the label (used on the social-proof step). */
export function RatingBar({ vertical = false }: { vertical?: boolean }) {
	return (
		<div
			className={`bg-stone-50 rounded-2xl p-4 flex ${
				vertical ? "flex-col items-center justify-center gap-2 text-center" : "items-center gap-3"
			}`}
		>
			<div className="flex items-center gap-1 shrink-0">
				<StarRating />
			</div>
			<p className="text-sm text-stone-600">
				Rated <span className="font-medium text-stone-900">{APP_STORE_RATING}</span> by{" "}
				{COLLECTOR_COUNT} collectors
			</p>
		</div>
	);
}
