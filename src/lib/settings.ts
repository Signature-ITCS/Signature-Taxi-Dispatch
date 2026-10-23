import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A company's non-secret, admin-editable settings (`app_settings`, one jsonb
 * value per key per company). Cached briefly to avoid a database hit on every
 * request. Server-only.
 *
 * Secret keys (Stripe, Resend, Cosmic SMS) are NOT here — see secrets.ts.
 */
type CacheEntry = { v: Record<string, unknown> | null; exp: number };
const cache = new Map<string, CacheEntry>();
const TTL = 30_000;

/** The whole jsonb value of one settings key for a company, or null. */
export async function getSetting(companyId: string, key: string): Promise<Record<string, unknown> | null> {
  const k = `${companyId}:${key}`;
  const hit = cache.get(k);
  if (hit && hit.exp > Date.now()) return hit.v;
  let v: Record<string, unknown> | null = null;
  try {
    const { data } = await createAdminClient()
      .from("app_settings")
      .select("value")
      .eq("company_id", companyId)
      .eq("key", key)
      .maybeSingle();
    v = (data?.value as Record<string, unknown>) ?? null;
  } catch {
    v = null;
  }
  cache.set(k, { v, exp: Date.now() + TTL });
  return v;
}

/** One text field of a company's settings key, or the fallback. */
export async function getConfigValue(
  companyId: string,
  key: string,
  field: string,
  fallback?: string
): Promise<string | undefined> {
  const val = (await getSetting(companyId, key))?.[field];
  return typeof val === "string" && val.trim() ? val : fallback;
}

/** Drop the cache (call after settings are saved). */
export function clearSettingsCache() {
  cache.clear();
}
