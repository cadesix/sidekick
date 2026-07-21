// DEV-only performance telemetry. The on-device app can't be profiled from the
// dev host, so we buffer frame timings + timing marks and flush them to the local
// dev server (POST /dev/perf → /tmp/sidekick-perf.jsonl), which the dev reads
// off-device. Everything here is fire-and-forget: no awaits on the hot path, no
// React state, and it no-ops entirely in production.

const ENABLED = process.env.NODE_ENV !== 'production';
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';

type Sample = Record<string, unknown> & { t: number };

let buffer: Sample[] = [];

// A per-launch id so multiple reload sessions in the log can be told apart. Not
// security-sensitive; Math.random is fine here (unlike in workflow scripts).
const sessionId = Math.floor(Math.random() * 1e6).toString(36);

/** Record a named timing mark (e.g. 'map:close:call'), with optional payload. */
export function perfMark(label: string, extra?: Record<string, unknown>): void {
  if (!ENABLED) return;
  buffer.push({ t: Date.now(), sid: sessionId, kind: 'mark', label, ...extra });
}

/** Record a render-loop frame-stats window. */
export function perfFrame(stats: Record<string, unknown>): void {
  if (!ENABLED) return;
  buffer.push({ t: Date.now(), sid: sessionId, kind: 'frame', ...stats });
}

// Flush the buffer to the dev server every 2s. Low frequency + batched so the
// telemetry itself doesn't perturb what it measures. Runs only in dev.
if (ENABLED) {
  setInterval(() => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    fetch(`${API_BASE}/dev/perf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ batch }),
    }).catch(() => {
      // best-effort; drop on failure rather than retaining an unbounded buffer
    });
  }, 2000);
}
