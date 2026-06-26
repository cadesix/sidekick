export function ProgressBar({ current, total }: { current: number; total: number }) {
	const segments = 3;
	const perSegment = total / segments;

	return (
		<div className="flex gap-1.5">
			{Array.from({ length: segments }).map((_, i) => {
				const segStart = i * perSegment;
				const raw = Math.min(1, Math.max(0, (current - segStart) / perSegment));
				// Seed the first segment so the very first screen already shows forward
				// momentum — an empty bar at step 0 reads as "long path, no progress".
				const fill = i === 0 ? Math.max(0.15, raw) : raw;
				return (
					<div
						key={`seg-${i}`}
						className="flex-1 h-[3px] bg-stone-200 rounded-full overflow-hidden"
					>
						<div
							className="h-full bg-stone-800 rounded-full transition-all duration-500 ease-out"
							style={{ width: `${fill * 100}%` }}
						/>
					</div>
				);
			})}
		</div>
	);
}
