/**
 * Per-user sliding-window rate limit for the live test route, so a signed-in
 * user can't turn /api/test into a high-volume request generator against
 * public sites.
 *
 * Kept in memory per server instance (no external store): a serverless
 * deployment may run several instances, so the real ceiling is this limit
 * times the instance count. It is a brake, not a quota.
 */

const WINDOW_MS = 60_000;
/** Generous enough for "Test all" (3 parallel tests) on a large site. */
export const TESTS_PER_MINUTE = 240;
/** Forget users idle for a window so the map doesn't grow without bound. */
const SWEEP_EVERY = 500;

const hits = new Map<string, number[]>();
let calls = 0;

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

export function takeTestSlot(userKey: string, now = Date.now()): RateLimitResult {
  const windowStart = now - WINDOW_MS;

  calls += 1;
  if (calls % SWEEP_EVERY === 0) {
    for (const [key, times] of hits) {
      if (times[times.length - 1] <= windowStart) hits.delete(key);
    }
  }

  const recent = (hits.get(userKey) ?? []).filter((time) => time > windowStart);
  if (recent.length >= TESTS_PER_MINUTE) {
    hits.set(userKey, recent);
    const retryAfterMs = recent[0] + WINDOW_MS - now;
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  recent.push(now);
  hits.set(userKey, recent);
  return { ok: true };
}
