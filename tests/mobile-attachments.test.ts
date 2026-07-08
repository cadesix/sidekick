import { expect, test } from "vitest";
import {
  bucketWaveform,
  formatBytes,
  formatDuration,
  meteringToAmplitude,
  playedBarCount,
  truncateFilename,
} from "../apps/mobile/features/chat/attachments";

test("formatBytes renders B / KB / MB the way the file bubble expects", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(2048)).toBe("2.0 KB");
  expect(formatBytes(64_000)).toBe("63 KB");
  expect(formatBytes(2_411_724)).toBe("2.3 MB");
});

test("formatDuration renders m:ss", () => {
  expect(formatDuration(7_000)).toBe("0:07");
  expect(formatDuration(83_000)).toBe("1:23");
  expect(formatDuration(0)).toBe("0:00");
});

test("meteringToAmplitude maps dBFS onto a 0..1 range with a -60dB floor", () => {
  expect(meteringToAmplitude(-160)).toBe(0);
  expect(meteringToAmplitude(0)).toBe(1);
  expect(meteringToAmplitude(-30)).toBeCloseTo(0.5, 5);
});

test("bucketWaveform always returns exactly `bars` heights", () => {
  expect(bucketWaveform([], 24)).toHaveLength(24);
  expect(bucketWaveform([], 24).every((h) => h === 0)).toBe(true);

  const ramp = Array.from({ length: 100 }, (_, i) => i / 99);
  const bars = bucketWaveform(ramp, 24);
  expect(bars).toHaveLength(24);
  // Averaged buckets are monotonically increasing across a rising ramp.
  for (let i = 1; i < bars.length; i++) {
    expect(bars[i]).toBeGreaterThan(bars[i - 1] ?? 0);
  }
  expect(bars.every((h) => h >= 0 && h <= 1)).toBe(true);
});

test("playedBarCount tracks playback position across the bar count", () => {
  expect(playedBarCount(0, 10_000, 24)).toBe(0);
  expect(playedBarCount(5_000, 10_000, 24)).toBe(12);
  expect(playedBarCount(10_000, 10_000, 24)).toBe(24);
  expect(playedBarCount(999, 0, 24)).toBe(0);
});

test("truncateFilename middle-truncates keeping the extension", () => {
  expect(truncateFilename("notes.txt")).toBe("notes.txt");
  const long = truncateFilename("quarterly-financial-report-2026.pdf", 22);
  expect(long.length).toBeLessThanOrEqual(22);
  expect(long).toContain("…");
  expect(long.endsWith(".pdf")).toBe(true);
});
