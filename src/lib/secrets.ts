import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * API keys and passwords — the platform's own and each company's.
 *
 * Saved encrypted (see crypto.ts), read only by the server at the moment of
 * use, and never sent back to any browser — not even partly: settings screens
 * only ever learn whether a key is set and when. Server-only.
 */

/** Keys a company can save in Settings. */
export const COMPANY_SECRETS = [
  "stripe_secret_key",
  "stripe_webhook_secret",
  "resend_api_key",
  "cosmic_username",
  "cosmic_password",
] as const;
export type CompanySecretName = (typeof COMPANY_SECRETS)[number];

/** Keys the platform owner saves in the master dashboard. */
export const PLATFORM_SECRETS = ["resend_api_key"] as const;
export type PlatformSecretName = (typeof PLATFORM_SECRETS)[number];

type CacheEntry = { v: string | null; exp: number };
const cache = new Map<string, CacheEntry>();
const TTL = 30_000;
const cacheKey = (companyId: string | null, name: string) => `${companyId ?? "platform"}:${name}`;

/** Decrypted value, or null when not set (or unreadable). companyId null = platform. */
export async function getSecret(companyId: string | null, name: string): Promise<string | null> {
  const k = cacheKey(companyId, name);
  const hit = cache.get(k);
  if (hit && hit.exp > Date.now()) return hit.v;
  let v: string | null = null;
  try {
    const admin = createAdminClient();
    let q = admin.from("secrets").select("ciphertext").eq("name", name);
    q = companyId ? q.eq("company_id", companyId) : q.is("company_id", null);
    const { data } = await q.maybeSingle();
    v = data?.ciphertext ? decryptSecret(data.ciphertext as string) : null;
  } catch (err) {
    console.error(`[secrets] could not read ${name}`, err instanceof Error ? err.message : err);
    v = null;
  }
  cache.set(k, { v, exp: Date.now() + TTL });
  return v;
}

/** Save (or with an empty value, remove) a secret. */
export async function setSecret(
  companyId: string | null,
  name: string,
  value: string,
  userId: string | null
): Promise<void> {
  const admin = createAdminClient();
  const trimmed = value.trim();
  let del = admin.from("secrets").delete().eq("name", name);
  del = companyId ? del.eq("company_id", companyId) : del.is("company_id", null);

  if (!trimmed) {
    const { error } = await del;
    if (error) throw error;
  } else {
    // Delete + insert: the unique index is on an expression, which an upsert
    // can't target. Both run back to back on the server.
    const { error: delErr } = await del;
    if (delErr) throw delErr;
    const { error } = await admin.from("secrets").insert({
      company_id: companyId,
      name,
      ciphertext: encryptSecret(trimmed),
      // No part of the key is kept in plain text, not even its last characters.
      last4: null,
      updated_by: userId,
    });
    if (error) throw error;
  }
  cache.delete(cacheKey(companyId, name));
}

export interface SecretStatus {
  set: boolean;
  updated_at: string | null;
}

/** Which secrets are set — safe to show in a browser (never the values). */
export async function secretStatus(companyId: string | null): Promise<Record<string, SecretStatus>> {
  const admin = createAdminClient();
  let q = admin.from("secrets").select("name, updated_at");
  q = companyId ? q.eq("company_id", companyId) : q.is("company_id", null);
  const { data } = await q;
  const out: Record<string, SecretStatus> = {};
  for (const r of (data ?? []) as { name: string; updated_at: string }[]) {
    out[r.name] = { set: true, updated_at: r.updated_at };
  }
  return out;
}
