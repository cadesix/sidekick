// iOS-home-screen-style dock: a frosted, rounded glass panel pinned to the bottom
// with four app icons. The icons are the shared 3D-rendered set in
// public/icons/*.png (they carry their own depth + shadow, so they float on the
// glass rather than sitting on colored squircles). Messages opens the chat sheet;
// Shop / Map / Goals are wired to callbacks. The whole dock fades down out of the
// way while the chat sheet is up, like the app covering the dock.

type DockProps = {
	hidden?: boolean;
	// unread sidekick messages — shown as an iOS-style red badge on Messages
	unread?: number;
	onMessages: () => void;
	onShop?: () => void;
	onMap?: () => void;
	onGoals?: () => void;
};

// one dock app: a floating 3D icon with a press-in shrink
function AppTile({ label, icon, onClick }: { label: string; icon: string; onClick?: () => void }) {
	return (
		<button
			type="button"
			aria-label={label}
			onClick={onClick}
			className="relative h-[54px] w-[54px] transition-transform duration-100 active:scale-90"
		>
			<img
				src={`/icons/${icon}.png`}
				alt=""
				draggable={false}
				className="h-full w-full object-contain drop-shadow-[0_3px_4px_rgba(0,0,0,0.18)]"
			/>
		</button>
	);
}

export function HomeDock({ hidden, unread = 0, onMessages, onShop, onMap, onGoals }: DockProps) {
	return (
		<div
			className={`pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center pb-[max(env(safe-area-inset-bottom),16px)] transition-all duration-300 ${
				hidden ? "translate-y-6 opacity-0" : "translate-y-0 opacity-100"
			}`}
		>
			<div className="pointer-events-auto flex items-center gap-[18px] rounded-[32px] border border-white/40 bg-white/25 px-[20px] py-[12px] backdrop-blur-2xl">
				{/* Messages — opens the chat sheet; unread badge on a wrapper */}
				<div className="relative">
					<AppTile label="Messages" icon="messages" onClick={onMessages} />
					{unread > 0 ? (
						<span className="pointer-events-none absolute -right-1 -top-1 z-10 grid h-[21px] min-w-[21px] place-items-center rounded-full bg-[#FF3B30] px-1.5 text-[11px] font-bold tabular-nums text-white shadow-[0_1px_4px_rgba(0,0,0,0.25)]">
							{unread > 9 ? "9+" : unread}
						</span>
					) : null}
				</div>

				<AppTile label="Shop" icon="shop" onClick={onShop} />
				<AppTile label="Map" icon="map" onClick={onMap} />
				<AppTile label="Goals" icon="goals" onClick={onGoals} />
			</div>
		</div>
	);
}
