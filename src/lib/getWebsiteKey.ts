import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Resolve a website's booking api_key from its slug (server-only).
 * Lets each embedded widget tag bookings to the correct source website
 * without ever exposing the api_key to the client.
 */
export async function getWebsiteKey(slug: string): Promise<string | null> {
  const s = (slug || "main").trim();
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("websites")
      .select("api_key")
      .eq("slug", s)
      .eq("is_active", true)
      .maybeSingle();
    if (data?.api_key) return data.api_key as string;
  } catch {
    // service role not configured — fall back below
  }
  if (s === "main" && process.env.WIDGET_API_KEY) return process.env.WIDGET_API_KEY;
  return null;
}
