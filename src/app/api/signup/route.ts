import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { siteOrigin, isOwnerEmail, provisionCompany } from "@/lib/provision";
import { isValidPhone } from "@/lib/format";

/**
 * A new company signs up. No payment is taken here: the account is made
 * straight away and subscriptions are billed by hand — the platform owner sends
 * a payment link for each invoice (Master → Billing) by email or WhatsApp.
 *
 *  - Plan with a free trial: the company starts on the trial; its first
 *    invoice appears in Master → Billing a week before the trial ends.
 *  - Plan without a trial: the company starts active and its first invoice
 *    appears in Master → Billing at once.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  if (!rateLimit(`signup:${clientIp(req)}`, 10, 60 * 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const company = String(b.company_name ?? "").trim().slice(0, 120);
  const name = String(b.full_name ?? "").trim().slice(0, 120);
  const email = String(b.email ?? "").trim().toLowerCase();
  const phone = String(b.phone ?? "").trim().slice(0, 30);
  const planCode = String(b.plan ?? "").trim();
  if (company.length < 2 || name.length < 2 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "missing_fields" });
  }
  if (!isValidPhone(phone)) return NextResponse.json({ ok: false, error: "invalid_phone" });

  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("plans")
    .select("id, code, name, trial_days")
    .eq("code", planCode)
    .eq("is_active", true)
    .eq("is_public", true)
    .maybeSingle();
  if (!plan) return NextResponse.json({ ok: false, error: "unknown_plan" });

  const { data: inUse } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (inUse || (await isOwnerEmail(email))) return NextResponse.json({ ok: false, error: "email_in_use" });

  const trialDays = Number(plan.trial_days) || 0;
  const origin = siteOrigin(new URL(req.url).origin);
  const result = await provisionCompany({
    companyName: company,
    ownerName: name,
    ownerEmail: email,
    ownerPhone: phone,
    planId: plan.id as string,
    status: trialDays > 0 ? "trialing" : "active",
    trialEndsAt: trialDays > 0 ? new Date(Date.now() + trialDays * 24 * 60 * 60_000).toISOString() : null,
    via: "signup",
    origin,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error === "email_in_use" ? "email_in_use" : "create_failed" });
  }
  return NextResponse.json({ ok: true, url: `${origin}/signup/done` });
}
