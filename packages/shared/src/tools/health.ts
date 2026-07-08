import { readHealthInputSchema } from "../health/types";
import { defineTool, type SidekickTool } from "./types";

/**
 * Health capability (12-life-integrations.md). Day-to-day health context reaches
 * the model through the memory block's RECENT section (rendered from `health_days`,
 * no round-trip). This single *device* tool exists for depth — "how's my sleep been
 * this month?" — running the native HealthKit query on the app and returning via
 * `chat.deviceToolResult`. If health isn't shared, the app returns
 * `{ error: 'device_unavailable' }` and the model says so in-voice.
 */
export const healthTools: SidekickTool[] = [
  defineTool({
    name: "read_health",
    description:
      "Look at the user's Apple Health history over the last N days (max 30) for one metric: steps, sleep, workouts, heart_rate, or calories. Use for reflective questions like 'how's my sleep been this month'. Day-to-day numbers are already in your context — only reach for this when you need a longer range. If health isn't shared, the app returns { error: 'device_unavailable' }; acknowledge it gently and move on.",
    execution: "client",
    parameters: readHealthInputSchema,
  }),
];
