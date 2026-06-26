import type { Testimonial } from "./constants";
import { StarRating } from "./star-rating";

export function TestimonialCard({
	testimonial,
	stars = false,
}: {
	testimonial: Testimonial;
	stars?: boolean;
}) {
	return (
		<div className="bg-white border border-stone-200 rounded-xl p-4">
			{stars ? (
				<div className="flex items-center gap-1.5 mb-2.5">
					<StarRating className="w-4 h-4" />
				</div>
			) : null}
			<div className="flex items-center gap-2 mb-2">
				<div
					className={`w-7 h-7 rounded-full ${testimonial.color} flex items-center justify-center text-xs font-semibold`}
				>
					{testimonial.initials}
				</div>
				<div className="flex-1">
					<p className="text-sm font-medium text-stone-900">{testimonial.name}</p>
					<p className="text-xs text-stone-400">{testimonial.role}</p>
				</div>
				<span className="text-xs font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
					{testimonial.metric}
				</span>
			</div>
			<p className="text-sm text-stone-600 leading-relaxed">&ldquo;{testimonial.quote}&rdquo;</p>
		</div>
	);
}
