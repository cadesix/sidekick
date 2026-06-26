import { LuStar } from "react-icons/lu";

const STARS = ["one", "two", "three", "four", "five"];

/** The five filled amber stars used across the funnel's rating rows. Callers
 * supply their own wrapper (gap/margin); this just renders the stars. */
export function StarRating({ className = "w-3.5 h-3.5" }: { className?: string }) {
	return (
		<>
			{STARS.map((star) => (
				<LuStar key={star} className={`${className} fill-amber-400 text-amber-400`} />
			))}
		</>
	);
}
