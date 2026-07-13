import { readHealthInputSchema, type DeviceToolFrameCall } from "@sidekick/shared";
import { submitDeviceToolResult } from "~/lib/api";
import { readHealthMetric } from "~/lib/health";
import { runDeviceTools } from "./stream-frames";
import { isFocusTool, runFocusDeviceTool } from "./focus-device-tools";

/** The shape a device tool returns when it can't run (12 — model handles it in-voice). */
const DEVICE_UNAVAILABLE = { error: "device_unavailable" } as const;

const TIMEOUT_MS = 8_000;

/** A device tool the model asked the app to run (from a turn's device-tool frame). */
export type DeviceToolCall = DeviceToolFrameCall;

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  const timeout = new Promise<T>((resolve) => setTimeout(() => resolve(fallback), TIMEOUT_MS));
  return Promise.race([promise, timeout]);
}

/**
 * Run one device tool natively and return its result value (12 §device tools).
 * `read_health` → `readHealthMetric`; the six `focus_*` tools → `runFocusDeviceTool`
 * (13). Unknown tools, bad input, failures and timeouts all resolve to
 * `{ error: 'device_unavailable' }` so the model degrades gracefully. Feature
 * engineers add their device tools here.
 */
export async function dispatchDeviceTool(call: DeviceToolCall): Promise<unknown> {
  try {
    if (call.toolName === "read_health") {
      const parsed = readHealthInputSchema.safeParse(call.input);
      if (!parsed.success) {
        return DEVICE_UNAVAILABLE;
      }
      return await withTimeout(readHealthMetric(parsed.data), DEVICE_UNAVAILABLE);
    }
    if (isFocusTool(call.toolName)) {
      const result = await withTimeout(runFocusDeviceTool(call.toolName, call.input), DEVICE_UNAVAILABLE);
      return result ?? DEVICE_UNAVAILABLE;
    }
    return DEVICE_UNAVAILABLE;
  } catch {
    return DEVICE_UNAVAILABLE;
  }
}

/**
 * Run every device-tool the model surfaced this turn and post each result back so
 * the server can continue (12). Each native call runs behind the lib/*.ts seams
 * (which return `device_unavailable` off-device); results post via
 * `chat.deviceToolResult` — idempotent server-side, so a retry is harmless.
 */
export async function runDeviceToolCalls(
  conversationId: string,
  calls: DeviceToolCall[],
): Promise<void> {
  await runDeviceTools(calls, dispatchDeviceTool, async (result) => {
    await submitDeviceToolResult({ conversationId, ...result });
  });
}
