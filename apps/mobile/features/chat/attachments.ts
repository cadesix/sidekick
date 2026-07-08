/**
 * Pure attachment helpers for the chat composer + bubbles (09). No React, no RN
 * imports — unit-tested directly. The UI layers (VoiceRecorder, FileBubble, …)
 * compose these.
 */

export type AttachmentKind = "image" | "audio" | "file";

/** A locally-picked attachment being uploaded/ingested before send. */
export type PendingAttachment = {
  id: string;
  kind: AttachmentKind;
  /** Local device URI (thumbnail / playback before upload completes). */
  localUri: string;
  mime: string;
  bytes: number;
  filename: string;
  width?: number;
  height?: number;
  durationMs?: number;
  /** Server attachment id, set once `createUploadUrl` returns. */
  attachmentId?: string;
  status: "uploading" | "processing" | "ready" | "failed";
  /** 0..1 upload progress while `status === "uploading"`. */
  progress: number;
};

const KB = 1024;
const MB = KB * 1024;

/** "512 B" / "2.3 MB" — the file-bubble size label (09 §file bubble). */
export function formatBytes(bytes: number): string {
  if (bytes < KB) {
    return `${bytes} B`;
  }
  if (bytes < MB) {
    return `${(bytes / KB).toFixed(bytes < 10 * KB ? 1 : 0)} KB`;
  }
  return `${(bytes / MB).toFixed(1)} MB`;
}

/** Milliseconds → `m:ss` for voice bubbles + the recording timer (09 §voice). */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * expo-av metering is dBFS (roughly -160..0). Map it to a 0..1 amplitude with a
 * -60dB noise floor so quiet passages still show a sliver of bar.
 */
export function meteringToAmplitude(db: number): number {
  const floor = -60;
  if (db <= floor) {
    return 0;
  }
  if (db >= 0) {
    return 1;
  }
  return (db - floor) / -floor;
}

/**
 * Downsample a stream of amplitudes (0..1) into exactly `bars` bucket heights for
 * the waveform. Averages each bucket; empty input yields flat zero bars. A short
 * input (recording just started) still returns `bars` values, front-loaded.
 */
export function bucketWaveform(amplitudes: number[], bars: number): number[] {
  if (bars <= 0) {
    return [];
  }
  if (amplitudes.length === 0) {
    return new Array(bars).fill(0);
  }
  const buckets: number[] = [];
  const perBucket = amplitudes.length / bars;
  for (let i = 0; i < bars; i++) {
    const start = Math.floor(i * perBucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * perBucket));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < amplitudes.length; j++) {
      sum += amplitudes[j] ?? 0;
      count += 1;
    }
    buckets.push(count > 0 ? sum / count : 0);
  }
  return buckets;
}

/**
 * How much of a voice waveform is "played" — bar index up to which bars render
 * filled (`bg-ink`) vs. unplayed (`bg-ink/25`), from playback position (09 §voice).
 */
export function playedBarCount(positionMs: number, durationMs: number, bars: number): number {
  if (durationMs <= 0) {
    return 0;
  }
  const ratio = Math.min(1, Math.max(0, positionMs / durationMs));
  return Math.round(ratio * bars);
}

/**
 * A stable pseudo-waveform (0..1 heights) for a played-back voice note, where no
 * live metering was captured. Deterministic in `seed` so a message's bars never
 * reshuffle between renders. Not signal-accurate — just a lively static shape.
 */
export function pseudoWaveform(seed: string, bars: number): number[] {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    const unit = ((hash >>> 0) % 1000) / 1000;
    out.push(0.25 + unit * 0.75);
  }
  return out;
}

/** Middle-truncate a long filename for the pending-chip / file bubble (09 §UI). */
export function truncateFilename(name: string, max = 22): string {
  if (name.length <= max) {
    return name;
  }
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const keep = max - ext.length - 1;
  if (keep <= 1) {
    return `${name.slice(0, max - 1)}…`;
  }
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${stem.slice(0, head)}…${stem.slice(stem.length - tail)}${ext}`;
}
