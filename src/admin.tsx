import { useEffect, useState } from "react";
import ChatLab from "./chat-lab";
import GraphicAssets from "./graphic-assets";
import SidekickStudio, { STUDIO_TABS, type StudioTab } from "./sidekick-studio";

// Admin hub — a single top bar: [Admin] [route dropdown] [active tool's subnav].
// Dev-only (gated in App). Add a tool by appending to TOOLS. `scroll: true` for
// normal scrolling pages, `false` for fixed-height (own-scroll) tools like chat.
type Tool = { id: string; label: string; path: string; scroll: boolean };

const TOOLS: Tool[] = [
	{ id: "chat-lab", label: "Chat Lab", path: "/admin/chat-lab", scroll: false },
	{ id: "studio", label: "Sidekick Studio", path: "/admin/studio", scroll: true },
	{ id: "graphic-assets", label: "Graphic Assets", path: "/admin/graphic-assets", scroll: true },
];

function tabFromPath(): string {
	const p = typeof window !== "undefined" ? window.location.pathname.replace(/\/$/, "") : "";
	return TOOLS.find((t) => t.path === p)?.id ?? TOOLS[0].id;
}

export default function Admin() {
	const [tool, setTool] = useState(tabFromPath);
	const [studioTab, setStudioTab] = useState<StudioTab>("cosmetics");

	// Reflect the active tool in the URL on first load (so /admin → /admin/chat-lab).
	useEffect(() => {
		const active = TOOLS.find((t) => t.id === tool);
		if (active && window.location.pathname.replace(/\/$/, "") !== active.path) {
			window.history.replaceState({}, "", active.path);
		}
		const onPop = () => setTool(tabFromPath());
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const go = (id: string) => {
		const t = TOOLS.find((x) => x.id === id);
		if (!t) return;
		setTool(id);
		window.history.pushState({}, "", t.path);
	};

	const active = TOOLS.find((t) => t.id === tool) ?? TOOLS[0];

	return (
		<div className="h-[100svh] flex flex-col bg-white">
			<header className="shrink-0 flex items-center gap-3 px-3 py-2 bg-white border-b border-[#111]/10">
				<span className="px-1 text-[14px] font-extrabold tracking-tight text-[#111]">Admin</span>
				<select
					value={tool}
					onChange={(e) => go(e.target.value)}
					className="rounded-lg border border-[#111]/15 bg-white px-2.5 py-1.5 text-[13px] font-bold text-[#111] focus:outline-none focus:border-[#111]/40"
				>
					{TOOLS.map((t) => (
						<option key={t.id} value={t.id}>
							{t.label}
						</option>
					))}
				</select>

				{tool === "studio" && (
					<nav className="flex items-center gap-1 overflow-x-auto no-scrollbar">
						<span className="mx-1 h-5 w-px bg-[#111]/10" />
						{STUDIO_TABS.map(([key, label]) => (
							<button
								key={key}
								onClick={() => setStudioTab(key)}
								className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${
									studioTab === key ? "bg-[#111] text-white" : "text-[#111]/55 hover:text-[#111]"
								}`}
							>
								{label}
							</button>
						))}
					</nav>
				)}
			</header>

			<div className={`flex-1 min-h-0 ${active.scroll ? "overflow-y-auto" : ""}`}>
				{tool === "studio" ? (
					<SidekickStudio tab={studioTab} onTabChange={setStudioTab} />
				) : tool === "graphic-assets" ? (
					<GraphicAssets />
				) : (
					<ChatLab />
				)}
			</div>
		</div>
	);
}
