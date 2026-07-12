// iOS-home-screen-style dock: a frosted, rounded glass panel pinned to the bottom
// with four app-icon "squircles". Messages opens the chat sheet; Shop / Map /
// Settings are wired to callbacks (placeholders for now). The whole dock fades
// down out of the way while the chat sheet is up, like the app covering the dock.

type DockProps = {
	hidden?: boolean;
	onMessages: () => void;
	onShop?: () => void;
	onMap?: () => void;
	onSettings?: () => void;
};

// one dock app: a rounded-squircle tile with a soft drop shadow and press-in
function AppTile({
	label,
	onClick,
	className,
	children,
}: {
	label: string;
	onClick?: () => void;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			onClick={onClick}
			className={`relative h-[58px] w-[58px] overflow-hidden rounded-[14px] ring-1 ring-black/5 transition-transform duration-100 active:scale-90 ${className ?? ""}`}
		>
			{children}
		</button>
	);
}

export function HomeDock({ hidden, onMessages, onShop, onMap, onSettings }: DockProps) {
	return (
		<div
			className={`pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center pb-[max(env(safe-area-inset-bottom),16px)] transition-all duration-300 ${
				hidden ? "translate-y-6 opacity-0" : "translate-y-0 opacity-100"
			}`}
		>
			<div className="pointer-events-auto flex items-center gap-[18px] rounded-[32px] border border-white/40 bg-white/25 px-[18px] py-[14px] shadow-[0_8px_30px_rgba(0,0,0,0.18)] backdrop-blur-2xl">
				{/* Messages — opens the chat sheet */}
				<AppTile label="Messages" onClick={onMessages} className="bg-gradient-to-b from-[#5BF76B] to-[#12C93E]">
					<svg viewBox="0 0 24 24" className="absolute left-1/2 top-1/2 h-[62%] w-[62%] -translate-x-1/2 -translate-y-1/2">
						<path
							fill="#fff"
							d="M12 4.2C6.9 4.2 3 7.3 3 11.2c0 2.2 1.3 4.2 3.3 5.5-.2 1.1-.8 2.1-1.5 2.9 1.5-.1 3.1-.6 4.3-1.5.9.3 1.9.4 2.9.4 5.1 0 9-3.1 9-7S17.1 4.2 12 4.2z"
						/>
					</svg>
				</AppTile>

				{/* Shop — shopping bag */}
				<AppTile label="Shop" onClick={onShop} className="bg-gradient-to-b from-[#FF9E5A] to-[#FF5E3A]">
					<svg viewBox="0 0 24 24" className="absolute left-1/2 top-1/2 h-[56%] w-[56%] -translate-x-1/2 -translate-y-1/2">
						<path
							fill="#fff"
							fillRule="evenodd"
							d="M9 8V7.4a3 3 0 0 1 6 0V8h2.1c.53 0 .97.4 1.02.93l.8 8.7A2 2 0 0 1 16.93 20H7.07a2 2 0 0 1-1.99-2.37l.8-8.7A1.02 1.02 0 0 1 6.9 8H9zm1.6 0h2.8v-.6a1.4 1.4 0 0 0-2.8 0V8zm-1.6 2.6a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8zm6 0a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8z"
							clipRule="evenodd"
						/>
					</svg>
				</AppTile>

				{/* Map — Apple-Maps-style: roads, a lake, a park patch and a red pin */}
				<AppTile label="Map" onClick={onMap}>
					<svg viewBox="0 0 60 60" className="absolute inset-0 h-full w-full">
						<rect width="60" height="60" fill="#eaf1e2" />
						<path d="M0 42C10 44 16 52 18 60L0 60Z" fill="#9fd0ff" />
						<path d="M60 0L60 22C50 22 44 14 44 0Z" fill="#c7e6a8" />
						<path d="M-6 16C18 26 34 30 66 12" stroke="#f2d9a0" strokeWidth="8" fill="none" />
						<path d="M-6 16C18 26 34 30 66 12" stroke="#fff" strokeWidth="1.6" strokeDasharray="3 3" fill="none" />
						<path d="M14 62L30 -2" stroke="#ffffff" strokeWidth="4" fill="none" />
						<path d="M36 22c0-3.3-2.7-6-6-6s-6 2.7-6 6c0 4.5 6 11 6 11s6-6.5 6-11z" fill="#ff5b4d" />
						<circle cx="30" cy="22" r="2.2" fill="#fff" />
					</svg>
				</AppTile>

				{/* Settings — grey gears */}
				<AppTile label="Settings" onClick={onSettings} className="bg-gradient-to-b from-[#d9d9de] to-[#a3a3aa]">
					<svg viewBox="0 0 24 24" className="absolute left-1/2 top-1/2 h-[64%] w-[64%] -translate-x-1/2 -translate-y-1/2">
						<path
							fill="#fff"
							d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.61l-1.92-3.32a.5.5 0 0 0-.59-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.57.24-1.12.56-1.62.94l-2.39-.96a.5.5 0 0 0-.59.22L2.74 8.87a.5.5 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.61l1.92 3.32c.13.22.39.3.59.22l2.39-.96c.5.38 1.05.7 1.62.94l.36 2.54c.05.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.57-.24 1.12-.56 1.62-.94l2.39.96c.2.08.46 0 .59-.22l1.92-3.32a.5.5 0 0 0-.12-.61l-2.03-1.58zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"
						/>
					</svg>
				</AppTile>
			</div>
		</div>
	);
}
