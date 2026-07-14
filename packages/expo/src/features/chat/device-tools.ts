import { type DeviceToolFrameCall } from "@sidekick/shared";
import { submitDeviceToolResult } from "~/lib/api";
import { runDeviceTools } from "./stream-frames";
import { DEVICE_UNAVAILABLE, runFocusDeviceTool } from "./focus-device-tools";

const TIMEOUT_MS = 8_000;

/** A device tool the model asked the app to run (from a turn's device-tool frame). */
export type DeviceToolCall = DeviceToolFrameCall;

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  const timeout = new Promise<T>((resolve) => setTimeout(() => resolve(fallback), TIMEOUT_MS));
  return Promise.race([promise, timeout]);
}

/**
 * Run one device tool natively and return its result value (12 §device tools).
 * Focus tools run on-device; each runner returns `null` for a tool it doesn't own,
 * so adding a capability means adding a runner here — not a name list to keep in
 * sync. Unknown tools, bad input, failures and timeouts all resolve to
 * `{ error: 'device_unavailable' }` so the model degrades gracefully.
 */
export async function dispatchDeviceTool(call: DeviceToolCall): Promise<unknown> {
  try {
    const result = await withTimeout(
      runFocusDeviceTool(call.toolName, call.input),
      DEVICE_UNAVAILABLE,
    );
    return result ?? DEVICE_UNAVAILABLE;
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
