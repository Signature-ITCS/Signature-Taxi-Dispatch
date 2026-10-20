import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearSettingsCache } from "@/lib/settings";

/** Admin-only. GET returns the editable (non-secret) config. */
export async function GET() {
  const me = await getSessionProfile();
  if (!me || me.role !== "admin") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ ok: false, error: "no_service_role_key" });
  }

  const [{ data: notif }, { data: company }, { data: staff }] = await Promise.all([
    admin.from("app_settings").select("value").eq("key", "notifications").maybeSingle(),
    admin.from("app_settings").select("value").eq("key", "company").maybeSingle(),
    admin.from("profiles").select("email").in("role", ["admin", "dispatcher"]).eq("is_active", true),
  ]);
  const n = (notif?.value as Record<string, unknown> | null) ?? {};
  const c = (company?.value as Record<string, string> | null) ?? {};

  // Booking-alert recipients. Until the admin saves a list, alerts go to every
  // active staff login (legacy behaviour) — surface those as the starting list.
  const savedList = Array.isArray(n.booking_alert_emails) ? (n.booking_alert_emails as string[]) : null;
  const staffEmails = ((staff ?? []) as { email: string | null }[])
    .map((s) => s.email?.trim().toLowerCase())
    .filter((e): e is string => !!e);

  return NextResponse.json({
    ok: true,
    config: {
      email_from: (n.email_from as string) || process.env.EMAIL_FROM || "",
      sms_sender: (n.sms_sender as string) || process.env.COSMICSMS_SENDER || "",
      reply_to: (n.reply_to as string) || "",
      timezone: c.timezone || "",
      booking_alert_emails: savedList ?? Array.from(new Set(staffEmails)),
      alert_emails_saved: savedList !== null,
    },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Admin-only. Updates the editable (non-secret) config. */
export async function POST(req: Request) {
  const me = await getSessionProfile();
  if (!me || me.role !== "admin") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ ok: false, error: "no_service_role_key" });
  }
  const b = await req.json().catch(() => ({}));

  // Non-secret config → app_settings (merge into existing jsonb)
  const { data: notifRow } = await admin.from("app_settings").select("value").eq("key", "notifications").maybeSingle();
  const notif = { ...((notifRow?.value as Record<string, unknown>) ?? {}) };
  if (typeof b.email_from === "string") notif.email_from = b.email_from.trim();
  if (typeof b.sms_sender === "string") notif.sms_sender = b.sms_sender.trim();
  // Where customer replies go. Kept as typed, minus anything that isn't an address.
  if (typeof b.reply_to === "string") {
    notif.reply_to = b.reply_to
      .split(/[,;s]+/)
      .map((e: string) => e.trim().toLowerCase())
      .filter((e: string) => EMAIL_RE.test(e))
      .slice(0, 5)
      .join(", ");
  }
  // Exact list of who gets the "New booking" alert. An empty list is valid
  // (nobody). Invalid / duplicate addresses are dropped rather than rejected.
  if (Array.isArray(b.booking_alert_emails)) {
    const cleaned = Array.from(
      new Set(
        (b.booking_alert_emails as unknown[])
          .map((e) => String(e ?? "").trim().toLowerCase())
          .filter((e) => e && EMAIL_RE.test(e))
      )
    ).slice(0, 50);
    notif.booking_alert_emails = cleaned;
  }
  await admin.from("app_settings").upsert({ key: "notifications", value: notif });

  const { data: compRow } = await admin.from("app_settings").select("value").eq("key", "company").maybeSingle();
  const comp = { ...((compRow?.value as Record<string, unknown>) ?? {}) };
  if (typeof b.timezone === "string") comp.timezone = b.timezone.trim();
  await admin.from("app_settings").upsert({ key: "company", value: comp });

  clearSettingsCache();
  await admin.from("activity_logs").insert({
    actor_id: me.id,
    actor_name: me.full_name,
    actor_role: me.role,
    action: "settings_updated",
    description: Array.isArray(b.booking_alert_emails)
      ? `Updated settings — booking alerts go to ${(notif.booking_alert_emails as string[]).length} address(es)`
      : "Updated notification & timezone settings",
  });

  return NextResponse.json({ ok: true });
}
