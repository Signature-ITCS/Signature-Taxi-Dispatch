import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformStripe } from "@/lib/stripe";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { siteOrigin } from "@/lib/provision";

/**
 * Start a new company's subscription: Stripe Checkout on the platform owner's
 * Stripe. Nothing is created here — the account is made when Stripe confirms
 * (platform webhook → provisionCompany), so an abandoned checkout leaves nothing.
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
  const planCode = String(b.plan ?? "").trim();
  if (company.length < 2 || name.length < 2 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "missing_fields" });
  }

  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("plans")
    .select("id, code, name, trial_days, stripe_price_id")
    .eq("code", planCode)
    .eq("is_active", true)
    .eq("is_public", true)
    .maybeSingle();
  if (!plan) return NextResponse.json({ ok: false, error: "unknown_plan" });

  const { data: inUse } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (inUse) return NextResponse.json({ ok: false, error: "email_in_use" });

  const stripe = await getPlatformStripe();
  if (!stripe || !plan.stripe_price_id) {
    return NextResponse.json({ ok: false, error: "signups_closed" });
  }

  const origin = siteOrigin(new URL(req.url).origin);
  const meta = { kind: "signup", company_name: company, full_name: name, plan_id: plan.id as string };
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      line_items: [{ price: plan.stripe_price_id as string, quantity: 1 }],
      subscription_data: {
        ...(plan.trial_days > 0 ? { trial_period_days: plan.trial_days as number } : {}),
        metadata: meta,
      },
      metadata: meta,
      allow_promotion_codes: true,
      success_url: `${origin}/signup/done?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/signup?plan=${encodeURIComponent(plan.code as string)}`,
    });
    return NextResponse.json({ ok: true, url: session.url });
  } catch (err) {
    console.error("[signup] checkout failed", err);
    return NextResponse.json({ ok: false, error: "payment_provider_error" });
  }
}
