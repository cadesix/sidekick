/**
 * In-memory sliding-window rate limiter (19-auth.md). tRPC has no per-request IP in
 * ctx today, so limits key on the identifier (email/phone) rather than IP — see the
 * plan's note. Per-instance and non-durable, which is fine for single-instance dev
 * and low traffic; Twilio Verify enforces its own limits for SMS regardless.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(
    private readonly points: number,
    private readonly durationMs: number,
  ) {}

  /** Record an attempt for `key`; false once the window is already full. */
  consume(key: string): boolean {
    const now = Date.now();
    this.sweep(now);
    const cutoff = now - this.durationMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.points) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /**
   * Drop keys whose entire window has elapsed so the map can't grow unbounded
   * with every address that ever requested a code. Runs at most once per window,
   * an O(n) pass over a map already bounded to keys seen within it.
   */
  private sweep(now: number): void {
    if (now - this.lastSweep < this.durationMs) {
      return;
    }
    this.lastSweep = now;
    const cutoff = now - this.durationMs;
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= cutoff)) {
        this.hits.delete(key);
      }
    }
  }
}

/** Email OTP requests: 3 per address per 15 minutes (invoice's per-email limit). */
export const emailRequestLimiter = new RateLimiter(3, 15 * 60 * 1000);

/** Phone OTP requests: 3 per number per hour (scaleshot's per-phone limit). */
export const phoneRequestLimiter = new RateLimiter(3, 60 * 60 * 1000);
