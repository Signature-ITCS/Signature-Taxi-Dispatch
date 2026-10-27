import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Two-factor sign-in (authenticator app, Supabase Auth TOTP). Server-only.
 *
 * - enrolled: the user has a confirmed authenticator;
 * - verified: this session passed its code ("aal2" in the token);
 * - required: they must have one now — always the platform owner; office
 *   staff (admins, dispatchers) once their 3-day grace is over, or straight
 *   away if their company requires it. Drivers never.
 * - graceUntil: office staff without one yet, still in their grace — prompt.
 *
 * "code"  → they have an authenticator but haven't entered its code yet;
 * "setup" → they must set one up before going further.
 * The database enforces the same rules (db/2026-10-28_two_factor.sql).
 */
export interface TwoFactor {
  enrolled: boolean;
  verified: boolean;
  required: boolean;
  graceUntil: string | null;
  block: null | "code" | "setup";
}

export async function twoFactorOf(supabase: SupabaseClient, required: boolean, graceUntil: string | null = null): Promise<TwoFactor> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const enrolled = data?.nextLevel === "aal2";
  const verified = data?.currentLevel === "aal2";
  const block = enrolled && !verified ? "code" : !enrolled && required ? "setup" : null;
  return { enrolled, verified, required, graceUntil: !enrolled && !required ? graceUntil : null, block };
}

export const officeRole = (role: string | null | undefined) => role === "admin" || role === "dispatcher";

/**
 * For a company login: must they have an authenticator now, and if not yet,
 * until when may they wait? (Mirrors current_company_id() in the database.)
 */
export function officeTwoFactor(role: string | null | undefined, companyRequires: boolean, dueAt: string | null | undefined) {
  if (!officeRole(role)) return { required: false, graceUntil: null as string | null };
  const overdue = !dueAt || new Date(dueAt).getTime() <= Date.now();
  return { required: companyRequires || overdue, graceUntil: companyRequires || overdue ? null : (dueAt as string) };
}
