import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimitShared } from "@/lib/rateLimit";
import { isValidPhone } from "@/lib/format";
import { isOwnerEmail, notifyOwner, siteOrigin } from "@/lib/provision";
import { verifyTurnstile } from "@/lib/turnstile";

/**
 * A driver or sole-trader operator applies to join the partner network.
 * Saved as "pending" — nothing is visible to any company and no login exists
 * until the platform owner checks the licences and approves it.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 120) => String(v ?? "").trim().slice(0, max);

export async function POST(req: Request) {
  if (!(await rateLimitShared(`partner-join:${clientIp(req)}`, 5, 60 * 60_000))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = b.kind === "operator" ? "operator" : "driver";
  const row = {
    full_name: str(b.full_name),
    email: str(b.email).toLowerCase(),
    phone: str(b.phone, 30),
    kind,
    council: str(b.council),
    badge_number: str(b.badge_number, 60),
    badge_expires: str(b.badge_expires, 10),
    vehicle_type: str(b.vehicle_type, 40) || null,
    vehicle_make: str(b.vehicle_make, 40) || null,
    vehicle_model: str(b.vehicle_model, 40) || null,
    vehicle_colour: str(b.vehicle_colour, 30) || null,
    vehicle_seats: Math.min(20, Math.max(1, Math.round(Number(b.vehicle_seats) || 4))),
    plate_number: str(b.plate_number, 20).toUpperCase() || null,
    vehicle_licence_number: str(b.vehicle_licence_number, 60) || null,
    vehicle_licence_expires: DATE_RE.test(str(b.vehicle_licence_expires, 10)) ? str(b.vehicle_licence_expires, 10) : null,
    operator_licence_number: kind === "operator" ? str(b.operator_licence_number, 60) || null : null,
    operator_council: kind === "operator" ? str(b.operator_council) || null : null,
    operator_licence_expires: kind === "operator" && DATE_RE.test(str(b.operator_licence_expires, 10)) ? str(b.operator_licence_expires, 10) : null,
    areas: str(b.areas, 300),
    about: str(b.about, 600) || null,
  };
  if (b.consent !== true) return NextResponse.json({ ok: false, error: "consent_needed" });
  if (!(await verifyTurnstile(b.turnstile, clientIp(req)))) return NextResponse.json({ ok: false, error: "robot_check" });
  if (row.full_name.length < 2 || !EMAIL_RE.test(row.email) || !row.council || !row.badge_number || !row.areas) {
    return NextResponse.json({ ok: false, error: "missing_fields" });
  }
  if (!isValidPhone(row.phone)) return NextResponse.json({ ok: false, error: "invalid_phone" });
  if (!DATE_RE.test(row.badge_expires) || row.badge_expires < new Date().toISOString().slice(0, 10)) {
    return NextResponse.json({ ok: false, error: "badge_expired" });
  }
  if (kind === "operator" && (!row.operator_licence_number || !row.operator_council)) {
    return NextResponse.json({ ok: false, error: "operator_details" });
  }

  const admin = createAdminClient();
  // One account per email across the platform (companies' logins included).
  const [{ data: dupe }, { data: staff }] = await Promise.all([
    admin.from("partners").select("id").eq("email", row.email).maybeSingle(),
    admin.from("profiles").select("id").eq("email", row.email).maybeSingle(),
  ]);
  if (dupe || staff || (await isOwnerEmail(row.email))) return NextResponse.json({ ok: false, error: "email_in_use" });

  const { error } = await admin.from("partners").insert(row);
  if (error) {
    console.error("[partners/join] insert failed", error);
    return NextResponse.json({ ok: false, error: error.code === "23505" ? "email_in_use" : "save_failed" });
  }
  const origin = siteOrigin(new URL(req.url).origin);
  await notifyOwner(
    `New partner application: ${row.full_name}`,
    [
      ["Name", row.full_name],
      ["Type", kind === "operator" ? "Driver with operator licence" : "Driver"],
      ["Licensing council", row.council],
      ["Badge", `${row.badge_number} (expires ${row.badge_expires})`],
      ["Areas", row.areas],
      ["Contact", `${row.email} · ${row.phone}`],
    ],
    `${origin}/master/partners`
  );
  return NextResponse.json({ ok: true });
}
