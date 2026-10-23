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
