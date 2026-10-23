import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who gets a company's internal alert emails (new booking, payment problems).
 *
 * The admin owns this list in Settings → Booking alert emails. An empty saved
 * list is a real answer ("nobody"), so it is respected. Only when the list has
 * never been saved do we fall back to the company's active staff logins.
 */
export async function staffAlertRecipients(companyId: string): Promise<string[]> {
  try {
    const admin = createAdminClient();
    const { data: notif } = await admin
      .from("app_settings")
      .select("value")
      .eq("company_id", companyId)
      .eq("key", "notifications")
      .maybeSingle();

    const saved = (notif?.value as { booking_alert_emails?: unknown } | null)?.booking_alert_emails;
    if (Array.isArray(saved)) {
      return saved.map((e) => String(e)).filter(Boolean);
    }

    const { data: staff } = await admin
      .from("profiles")
      .select("email")
      .eq("company_id", companyId)
      .in("role", ["admin", "dispatcher"])
      .eq("is_active", true);
    return ((staff ?? []) as { email: string | null }[])
      .map((s) => s.email)
      .filter((e): e is string => !!e);
  } catch {
    return [];
  }
}
