export function StepHeader({
	title,
	subtitle,
	titleClassName,
	subtitleClassName,
}: {
	title: string;
	subtitle?: string;
	titleClassName?: string;
	subtitleClassName?: string;
}) {
	return (
		<div className="px-6 pt-7 pb-2 shrink-0">
			<h2
				className={`leading-tight text-stone-900 mb-1.5 ${
					titleClassName ?? "text-[24px] font-bold tracking-[-0.02em]"
				}`}
			>
				{title}
			</h2>
			{subtitle ? (
				<p className={`text-[14px] leading-relaxed mb-3 ${subtitleClassName ?? "text-stone-500"}`}>
					{subtitle}
				</p>
			) : (
				<div className="mb-3" />
			)}
		</div>
	);
}
