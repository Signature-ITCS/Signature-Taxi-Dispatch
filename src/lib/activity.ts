import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Record a small activity/audit event. Best-effort — never throws, so logging
 * can't break the actual action. Actor is taken from the caller's auth session
 * by the `log_activity` RPC (SECURITY DEFINER).
 */
export async function logActivity(
  supabase: SupabaseClient,
  action: string,
  description: string,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.rpc("log_activity", {
      p_action: action,
      p_description: description,
      p_meta: meta ?? null,
    });
  } catch {
    /* logging must never break the real action */
  }
}
