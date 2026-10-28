/**
 * Minimal in-memory fixed-window rate limiter.
 *
 * Good enough to blunt casual abuse of the public Google-proxy endpoints
 * (address search / distance) so they can't be hammered to run up the
 * Maps API bill. Note: state is per-server-instance, so on a multi-instance
 * / serverless deployment this is best-effort, not a hard global cap — pair
 * it with an HTTP-referrer + API restriction on the Google key itself.
 */
type Window = { count: number; resetAt: number };
const buckets = new Map<string, Window>();

/** Returns true if the call is allowed, false if the limit is exceeded. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const w = buckets.get(key);
  if (!w || now >= w.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    // Opportunistic cleanup so the map can't grow unbounded.
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    }
    return true;
  }
  if (w.count >= limit) return false;
  w.count++;
  return true;
}

/** Best-effort client IP from common proxy headers. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/**
 * The same limit, shared by every server: counted in the database
 * (hit_rate_limit, db/2026-10-29_rate_limits.sql), after this server's own
 * in-memory check. Use it for anything a bot would hammer — sign-ups,
 * applications, password resets, bookings, paid look-ups. If the database
 * can't be reached the in-memory result stands, so a hiccup never locks
 * real people out. Server-only.
 */
export async function rateLimitShared(key: string, limit: number, windowMs: number): Promise<boolean> {
  if (!rateLimit(key, limit, windowMs)) return false;
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data, error } = await createAdminClient().rpc("hit_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: Math.max(1, Math.round(windowMs / 1000)),
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}
