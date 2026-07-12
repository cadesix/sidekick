// Design Language — the centralized home for Sidekick's brand visual language.
// Placeholder for now; this tab will become the single source of truth that
// both humans and generation tooling (illustrate skill → gpt-image-2) read from.

const PLANNED = [
	{
		title: "Visual references",
		body: "The canonical reference images — character anchors, approved renders, icon exemplars — that get attached to every image generation so new assets stay on-style.",
	},
	{
		title: "Design language description",
		body: "A strong written description of the visual language: palette, materials, lighting, geometry, mood. This is the style context we prepend to every gpt-image-2 prompt, kept here instead of scattered across configs.",
	},
	{
		title: "Character sheet — source of truth",
		body: "The Sidekick character sheet is the locked source of truth for all generated product imagery. Anything we generate (poses, props, scenes, cosmetics) must match it exactly — only pose, prop, expression, and scene may vary.",
	},
];

export default function DesignLanguage() {
	return (
		<div className="max-w-2xl mx-auto px-6 py-10">
			<h1 className="text-[27px] font-extrabold leading-tight tracking-[-0.02em] text-[#111]">
				Design Language
			</h1>
			<p className="mt-1.5 text-[15px] leading-relaxed text-[#111]/55">
				One place for the brand's visual language. Coming together here:
			</p>

			<div className="mt-6 flex flex-col gap-3">
				{PLANNED.map((item) => (
					<div
						key={item.title}
						className="rounded-2xl border-2 border-[#111] shadow-[2px_2px_0_0_#111] bg-white px-5 py-4"
					>
						<div className="text-[17px] font-bold text-[#111]">{item.title}</div>
						<p className="mt-1 text-[14px] leading-relaxed text-[#111]/55">{item.body}</p>
					</div>
				))}
			</div>
		</div>
	);
}
