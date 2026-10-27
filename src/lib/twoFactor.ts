import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Two-factor sign-in (authenticator app, Supabase Auth TOTP). Server-only.
 *
 * - enrolled: the user has a confirmed authenticator;
 * - verified: this session passed its code ("aal2" in the token);
 * - required: they must have one — always the platform owner, and office staff
 *   (admins, dispatchers) of a company that requires it. Drivers never.
 *
 * "code"  → they have an authenticator but haven't entered its code yet;
 * "setup" → they must set one up before going further.
 * The database enforces the same rules (db/2026-10-28_two_factor.sql).
 */
export interface TwoFactor {
  enrolled: boolean;
  verified: boolean;
  required: boolean;
  block: null | "code" | "setup";
}

export async function twoFactorOf(supabase: SupabaseClient, required: boolean): Promise<TwoFactor> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const enrolled = data?.nextLevel === "aal2";
  const verified = data?.currentLevel === "aal2";
  const block = enrolled && !verified ? "code" : !enrolled && required ? "setup" : null;
  return { enrolled, verified, required, block };
}

export const officeRole = (role: string | null | undefined) => role === "admin" || role === "dispatcher";
