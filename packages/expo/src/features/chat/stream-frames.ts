import {
  DEVICE_TOOL_PREFIX,
  SEARCH_STREAM_END,
  SEARCH_STREAM_START,
  STREAM_META_DELIMITER,
  STREAM_META_PREFIX,
  decodeDeviceToolCalls,
  decodeStreamMeta,
  type DeviceToolFrameCall,
  type StreamMeta,
} from "@sidekick/shared";

export type FrameHandlers = {
  /** A web search started/finished (11) — toggles the "looking it up…" caption. */
  onSearch: (active: boolean) => void;
  /** End-of-stream metadata: reply chips + (onboarding) the current beat. */
  onMeta: (meta: StreamMeta) => void;
  /** The model asked the app to run native device tools (12). */
  onDeviceTools: (calls: DeviceToolFrameCall[]) => void;
};

/**
 * Split any control frames out of a decoded buffer: search frames (11) toggle
 * `onSearch`; the device-tool frame (12) fires `onDeviceTools`; the end-of-stream
 * meta frame (reply chips + onboarding beat) fires `onMeta`. Prose is returned as
 * `text`. Any trailing bytes that could be the start of an unfinished frame are
 * held back in `rest` and retried on the next read — frames never span a chunk
 * incorrectly. Pure (no network) so the whole frame protocol is unit-testable.
 */
export function drainStreamFrames(
  buffer: string,
  handlers: FrameHandlers,
): { text: string; rest: string } {
  let text = "";
  let cursor = 0;
  while (cursor < buffer.length) {
    const marker = buffer.indexOf(STREAM_META_DELIMITER, cursor);
    if (marker === -1) {
      text += buffer.slice(cursor);
      return { text, rest: "" };
    }
    text += buffer.slice(cursor, marker);
    if (buffer.startsWith(SEARCH_STREAM_START, marker)) {
      handlers.onSearch(true);
      cursor = marker + SEARCH_STREAM_START.length;
    } else if (buffer.startsWith(SEARCH_STREAM_END, marker)) {
      handlers.onSearch(false);
      cursor = marker + SEARCH_STREAM_END.length;
    } else if (buffer.startsWith(DEVICE_TOOL_PREFIX, marker)) {
      const payloadStart = marker + DEVICE_TOOL_PREFIX.length;
      const end = buffer.indexOf(STREAM_META_DELIMITER, payloadStart);
      if (end === -1) {
        return { text, rest: buffer.slice(marker) };
      }
      const calls = decodeDeviceToolCalls(buffer.slice(payloadStart, end));
      if (calls) {
        handlers.onDeviceTools(calls);
      }
      cursor = end + STREAM_META_DELIMITER.length;
    } else if (buffer.startsWith(STREAM_META_PREFIX, marker)) {
      const payloadStart = marker + STREAM_META_PREFIX.length;
      const end = buffer.indexOf(STREAM_META_DELIMITER, payloadStart);
      if (end === -1) {
        return { text, rest: buffer.slice(marker) };
      }
      const meta = decodeStreamMeta(buffer.slice(payloadStart, end));
      if (meta) {
        handlers.onMeta(meta);
      }
      cursor = end + STREAM_META_DELIMITER.length;
    } else {
      return { text, rest: buffer.slice(marker) };
    }
  }
  return { text, rest: "" };
}

/**
 * Run each device tool and post its result back, in order (12). Pure over its
 * injected `dispatch` (the native call, behind the lib/*.ts seams) and `post`
 * (the `chat.deviceToolResult` mutation) so the dispatch→post path is testable
 * without a device — both seams degrade to `{ error: 'device_unavailable' }` in
 * a non-device env, which is exactly what the model then narrates.
 */
export async function runDeviceTools(
  calls: DeviceToolFrameCall[],
  dispatch: (call: DeviceToolFrameCall) => Promise<unknown>,
  post: (result: { toolCallId: string; toolName: string; result: unknown }) => Promise<void>,
): Promise<void> {
  for (const call of calls) {
    const result = await dispatch(call);
    await post({ toolCallId: call.toolCallId, toolName: call.toolName, result });
  }
}
