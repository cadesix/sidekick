import { describe, expect, it, vi } from "vitest";
import {
  type DeviceToolFrameCall,
  type StreamMeta,
  encodeDeviceToolCalls,
  encodeStreamMeta,
  SEARCH_STREAM_START,
} from "@sidekick/shared";
import { drainStreamFrames, runDeviceTools } from "../packages/expo/src/features/chat/stream-frames";

function collector() {
  const calls: DeviceToolFrameCall[] = [];
  const metas: StreamMeta[] = [];
  const searches: boolean[] = [];
  return {
    calls,
    metas,
    searches,
    handlers: {
      onSearch: (active: boolean) => searches.push(active),
      onMeta: (meta: StreamMeta) => metas.push(meta),
      onDeviceTools: (c: DeviceToolFrameCall[]) => calls.push(...c),
    },
  };
}

/** Feed a whole stream string through the read loop, one chunk at a time, like the reader. */
function consume(chunks: string[]) {
  const c = collector();
  let pending = "";
  let text = "";
  for (const chunk of chunks) {
    pending += chunk;
    const drained = drainStreamFrames(pending, c.handlers);
    pending = drained.rest;
    text += drained.text;
  }
  return { ...c, text, pending };
}

describe("drainStreamFrames — device-tool frame", () => {
  it("extracts a device-tool frame and keeps surrounding prose", () => {
    const frame = encodeDeviceToolCalls([
      { toolCallId: "d1", toolName: "focus_block_now", input: {} },
    ]);
    const { calls, text } = consume([`ok one sec${frame}`]);
    expect(text).toBe("ok one sec");
    expect(calls).toEqual([{ toolCallId: "d1", toolName: "focus_block_now", input: {} }]);
  });

  it("reassembles a frame split across two reads", () => {
    const frame = encodeDeviceToolCalls([
      { toolCallId: "d2", toolName: "read_health", input: { metric: "steps", range_days: 7 } },
    ]);
    const full = `hi${frame}`;
    const mid = Math.floor(full.length / 2);
    const { calls, text, pending } = consume([full.slice(0, mid), full.slice(mid)]);
    expect(text).toBe("hi");
    expect(pending).toBe("");
    expect(calls).toEqual([
      { toolCallId: "d2", toolName: "read_health", input: { metric: "steps", range_days: 7 } },
    ]);
  });

  it("coexists with search + meta frames in one stream", () => {
    const frame = encodeDeviceToolCalls([{ toolCallId: "d3", toolName: "focus_status", input: {} }]);
    const meta = encodeStreamMeta({ replies: ["yeah", "nah"] });
    const { calls, searches, metas, text } = consume([
      `${SEARCH_STREAM_START}looking${frame}done${meta}`,
    ]);
    expect(text).toBe("lookingdone");
    expect(searches).toEqual([true]);
    expect(calls).toEqual([{ toolCallId: "d3", toolName: "focus_status", input: {} }]);
    expect(metas).toEqual([{ replies: ["yeah", "nah"] }]);
  });
});

describe("runDeviceTools — dispatch → post path", () => {
  it("dispatches each call then posts its result, in order", async () => {
    const posted: { toolCallId: string; result: unknown }[] = [];
    const dispatch = vi.fn(async (call: DeviceToolFrameCall) => ({ ran: call.toolName }));
    const post = vi.fn(async (r: { toolCallId: string; toolName: string; result: unknown }) => {
      posted.push({ toolCallId: r.toolCallId, result: r.result });
    });
    await runDeviceTools(
      [
        { toolCallId: "a", toolName: "focus_block_now", input: {} },
        { toolCallId: "b", toolName: "focus_unblock", input: { minutes: 10 } },
      ],
      dispatch,
      post,
    );
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(posted).toEqual([
      { toolCallId: "a", result: { ran: "focus_block_now" } },
      { toolCallId: "b", result: { ran: "focus_unblock" } },
    ]);
  });

  it("posts the device_unavailable sentinel a failing dispatch returns", async () => {
    const post = vi.fn(async () => {});
    await runDeviceTools(
      [{ toolCallId: "x", toolName: "read_health", input: {} }],
      async () => ({ error: "device_unavailable" }),
      post,
    );
    expect(post).toHaveBeenCalledWith({
      toolCallId: "x",
      toolName: "read_health",
      result: { error: "device_unavailable" },
    });
  });
});
