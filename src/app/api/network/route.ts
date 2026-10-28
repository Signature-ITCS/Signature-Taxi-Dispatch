import { NextResponse } from "next/server";
import { getOfficeContext } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimitShared } from "@/lib/rateLimit";
import { notifyOwner, siteOrigin } from "@/lib/provision";
import { getPlatformName } from "@/lib/companyBrand";
import { directoryView, isListed, isAvailable, whatsappLink, type Partner } from "@/lib/partners";

/**
 * The partner network, for office staff (admins and dispatchers) of open
 * companies who have passed two-factor sign-in if they need it. Lists only
 * approved, paid-up partners with licences in date — without phone numbers.
 */
export async function GET() {
  const office = await getOfficeContext();
  if (!office) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const { data } = await createAdminClient().from("partners").select("*").eq("status", "active");
  const partners = ((data ?? []) as Partner[])
    .filter((p) => isListed(p))
    .sort((a, b) => Number(isAvailable(b)) - Number(isAvailable(a)) || a.full_name.localeCompare(b.full_name))
    .map(directoryView);
  return NextResponse.json({ ok: true, partners });
}

/**
 * { action: "contact", partner_id } → the partner's WhatsApp link (logged);
 * { action: "report", partner_id, reason } → a complaint to the platform owner.
 */
export async function POST(req: Request) {
  const office = await getOfficeContext();
  if (!office) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof b.partner_id === "string" ? b.partner_id : "";
  const admin = createAdminClient();
  const { data } = await admin.from("partners").select("*").eq("id", id).maybeSingle();
  const p = data as Partner | null;
  if (!p || !isListed(p)) return NextResponse.json({ ok: false, error: "not_found" });
  const who = { company_id: office.company.id, user_id: office.userId, user_name: office.profile.full_name };

  if (b.action === "contact") {
    // Numbers are given out one at a time, so a login can't scrape the lot.
    if (!(await rateLimitShared(`network-contact:${office.userId}`, 40, 60 * 60_000))) {
      return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    }
    await admin.from("partner_contacts").insert({ partner_id: p.id, ...who });
    const text = `Hello ${p.full_name.split(" ")[0]}, this is ${office.profile.full_name} from ${office.company.name} (via ${await getPlatformName()}). Are you free to cover a job?`;
    return NextResponse.json({ ok: true, phone: p.phone, whatsapp: whatsappLink(p.phone, text) });
  }

  if (b.action === "report") {
    const reason = String(b.reason ?? "").trim().slice(0, 1000);
    if (reason.length < 5) return NextResponse.json({ ok: false, error: "reason_needed" });
    if (!(await rateLimitShared(`network-report:${office.userId}`, 10, 60 * 60_000))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    await admin.from("partner_reports").insert({ partner_id: p.id, ...who, reason });
    await notifyOwner(
      `Partner reported: ${p.full_name}`,
      [
        ["Partner", `${p.full_name} (${p.council}, badge ${p.badge_number})`],
        ["Reported by", `${office.profile.full_name} — ${office.company.name}`],
        ["Reason", reason],
      ],
      `${siteOrigin(new URL(req.url).origin)}/master/partners`
    );
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: "bad_action" });
}
