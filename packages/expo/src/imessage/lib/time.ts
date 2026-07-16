const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// Messages inserts a separator when >15 minutes pass between messages.
export const SEPARATOR_GAP = 15 * MINUTE;

const startOfDay = (timestamp: number): number => {
	const date = new Date(timestamp);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
};

export const formatClockTime = (timestamp: number): string =>
	new Date(timestamp).toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});

const WEEKDAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

export interface SeparatorLabel {
	day: string;
	time: string;
}

// "Today 9:41 AM" / "Yesterday 9:41 AM" / "Monday 9:41 AM" / "Mon, Jun 30 at 9:41 AM"
export const formatSeparator = (timestamp: number, now: number): SeparatorLabel => {
	const time = formatClockTime(timestamp);
	const dayStart = startOfDay(timestamp);
	const todayStart = startOfDay(now);
	if (dayStart === todayStart) {
		return { day: "Today", time };
	}
	if (todayStart - dayStart === DAY) {
		return { day: "Yesterday", time };
	}
	const date = new Date(timestamp);
	if (todayStart - dayStart < 7 * DAY) {
		return { day: WEEKDAYS[date.getDay()], time };
	}
	const sameYear = date.getFullYear() === new Date(now).getFullYear();
	const day = date.toLocaleDateString(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: sameYear ? undefined : "numeric",
	});
	return { day, time: `at ${time}` };
};

export const formatDuration = (seconds: number): string => {
	const whole = Math.max(0, Math.round(seconds));
	const minutes = Math.floor(whole / 60);
	const rest = whole % 60;
	return `${minutes}:${rest.toString().padStart(2, "0")}`;
};
