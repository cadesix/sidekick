import { useEffect, useState } from "react";
import { LuCheck, LuMessageCircle, LuX } from "react-icons/lu";
import { GOAL_OPTIONS, loadGoals } from "../home";

// Bottom-sheet "Goals": the user's onboarding goals, each simply done or not
// done today. Tapping a goal expands an action row — mark it done, or "Talk
// about it", which opens that goal in chat. Completion is stored per day inside
// per-ISO-week rows (sidekick_habit_checks_v1), so streak views can come later
// without a storage migration.

const CHECKS_KEY = "sidekick_habit_checks_v1";

// ISO-8601 week key (e.g. "2026-W28"): Thursday of the current week decides the year
function weekKey(d = new Date()): string {
	const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
	const day = t.getUTCDay() || 7;
	t.setUTCDate(t.getUTCDate() + 4 - day);
	const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
	const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
	return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// Mon-based index of today into a 7-slot week row
function todayIndex(): number {
	return (new Date().getDay() + 6) % 7;
}

type WeekChecks = Record<string, boolean[]>; // goal id → 7 days (Mon..Sun)

function loadChecks(week: string): WeekChecks {
	try {
		const all = JSON.parse(localStorage.getItem(CHECKS_KEY) ?? "{}") ?? {};
		return all[week] ?? {};
	} catch {
		return {};
	}
}

function saveChecks(week: string, checks: WeekChecks): void {
	try {
		const all = JSON.parse(localStorage.getItem(CHECKS_KEY) ?? "{}") ?? {};
		all[week] = checks;
		localStorage.setItem(CHECKS_KEY, JSON.stringify(all));
	} catch {
		// storage full/blocked — checks just won't persist
	}
}

export function GoalsSheet({
	open,
	onClose,
	onTalk,
}: {
	open: boolean;
	onClose: () => void;
	// "Talk about it" — the host closes this sheet and opens the goal in chat
	onTalk?: (goalLabel: string) => void;
}) {
	// the user's onboarding picks first, topped up from the goal catalog to 4
	const chosen = loadGoals();
	const goals = [...chosen, ...GOAL_OPTIONS.filter((o) => !chosen.some((c) => c.value === o.value))].slice(0, 4);
	const week = weekKey();
	const [checks, setChecks] = useState<WeekChecks>(() => loadChecks(week));
	const [expandedId, setExpandedId] = useState<string | null>(null);
	// re-read when opening — another tab/session may have marked goals done
	useEffect(() => {
		if (open) {
			setChecks(loadChecks(week));
			setExpandedId(null);
		}
	}, [open, week]);

	const doneToday = (goalId: string) => (checks[goalId] ?? [])[todayIndex()] ?? false;
	const toggleToday = (goalId: string) => {
		const row = [...(checks[goalId] ?? Array(7).fill(false))];
		row[todayIndex()] = !row[todayIndex()];
		const next = { ...checks, [goalId]: row };
		setChecks(next);
		saveChecks(week, next);
	};

	return (
		<div
			className={`absolute inset-x-0 bottom-0 z-40 h-[62%] transition-transform duration-300 ease-out ${
				open ? "translate-y-0" : "pointer-events-none translate-y-full"
			}`}
		>
			<div className="flex h-full flex-col rounded-t-[28px] bg-white shadow-[0_-8px_40px_rgba(0,0,0,0.22)]">
				{/* grabber + header */}
				<div className="relative shrink-0 px-5 pt-3">
					<div className="mx-auto h-1.5 w-10 rounded-full bg-neutral-200" />
					<div className="mt-2 flex items-center justify-between">
						<div className="text-[22px] font-extrabold text-neutral-900">Daily goals</div>
						<button
							onClick={onClose}
							aria-label="Close goals"
							className="grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-neutral-500 active:bg-neutral-200"
						>
							<LuX className="h-5 w-5" strokeWidth={2.5} />
						</button>
					</div>
				</div>

				{/* one card per goal: icon, label, done-or-not; tap to expand actions */}
				<div className="no-scrollbar mt-3 flex-1 space-y-2.5 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),16px)]">
					{goals.map((g) => {
						const done = doneToday(g.value);
						const expanded = expandedId === g.value;
						return (
							<div key={g.value} className="overflow-hidden rounded-[18px] bg-neutral-100 shadow-[0_3px_0_rgba(0,0,0,0.08)]">
								<button
									type="button"
									onClick={() => setExpandedId(expanded ? null : g.value)}
									className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left active:bg-neutral-200/60"
								>
									<span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white">
										<img src={g.icon} alt="" draggable={false} className="h-8 w-8 object-contain" />
									</span>
									<div className="min-w-0 flex-1">
										<div className="truncate text-[15px] font-bold text-neutral-900">{g.label}</div>
										<div className={`truncate text-[12px] ${done ? "font-semibold text-[#12C93E]" : "text-neutral-400"}`}>
											{done ? "Completed" : "Not completed"}
										</div>
									</div>
									<span
										className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors ${
											done
												? "bg-[#12C93E] text-white shadow-[0_2px_8px_rgba(18,201,62,0.4)]"
												: "bg-white text-transparent ring-1 ring-neutral-200"
										}`}
									>
										<LuCheck className="h-4 w-4" strokeWidth={3} />
									</span>
								</button>
								{expanded ? (
									<div className="flex gap-2 px-4 pb-4">
										<button
											type="button"
											onClick={() => toggleToday(g.value)}
											className={`flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2.5 text-[14px] font-semibold transition-all duration-100 ${
												done
											? "bg-neutral-100 text-neutral-500 shadow-[0_3px_0_rgba(0,0,0,0.10)] active:translate-y-[2px] active:shadow-[0_1px_0_rgba(0,0,0,0.10)]"
											: "bg-[#12C93E] text-white shadow-[0_3px_0_#0da32f] active:translate-y-[2px] active:shadow-[0_1px_0_#0da32f]"
											}`}
										>
											<LuCheck className="h-4 w-4" strokeWidth={3} />
											{done ? "Undo" : "Mark done"}
										</button>
										<button
											type="button"
											onClick={() => onTalk?.(g.label)}
											className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-[#0a84ff] py-2.5 text-[14px] font-semibold text-white shadow-[0_3px_0_#0868c8] transition-all duration-100 active:translate-y-[2px] active:shadow-[0_1px_0_#0868c8]"
										>
											<LuMessageCircle className="h-4 w-4" strokeWidth={2.5} />
											Talk about it
										</button>
									</div>
								) : null}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
