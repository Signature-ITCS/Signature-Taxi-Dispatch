import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformStripe } from "@/lib/stripe";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import type Stripe from "stripe";
import { siteOrigin, isOwnerEmail, provisionCompany } from "@/lib/provision";
import { companyFieldsFromSubscription } from "@/lib/billing";

/**
 * Start a new company's subscription on the platform owner's Stripe — paid by
 * monthly invoice, never by a saved or automatically charged card.
 *
 *  - Plan with a free trial: the subscription and the account are made now; no
 *    card is asked for. The first invoice is emailed when the trial ends.
 *  - Plan without a trial: the first invoice is opened for payment straight
 *    away and the account is made once Stripe confirms it was paid.
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
  if (inUse || (await isOwnerEmail(email))) return NextResponse.json({ ok: false, error: "email_in_use" });

  const stripe = await getPlatformStripe();
  if (!stripe || !plan.stripe_price_id) {
    return NextResponse.json({ ok: false, error: "signups_closed" });
  }

  const origin = siteOrigin(new URL(req.url).origin);
  const meta = { kind: "signup", company_name: company, full_name: name, plan_id: plan.id as string };
  const trialDays = Number(plan.trial_days) || 0;

  // Billed by INVOICE, never by a saved card: no card is asked for here, and
  // every month Stripe emails an invoice the company pays by typing a card in
  // on Stripe's page. collection_method "send_invoice" means Stripe never
  // charges anything automatically.
  let customerId: string | null = null;
  let sub: Stripe.Subscription;
  try {
    customerId = (await stripe.customers.create({ email, name: company, metadata: meta })).id;
    sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: plan.stripe_price_id as string }],
      collection_method: "send_invoice",
      days_until_due: DAYS_TO_PAY,
      ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
      payment_settings: { payment_method_types: ["card"] },
      metadata: meta,
    });
  } catch (err) {
    console.error("[signup] subscription failed", err);
    if (customerId) await stripe.customers.del(customerId).catch(() => {});
    return NextResponse.json({ ok: false, error: "payment_provider_error" });
  }

  if (trialDays > 0) {
    // Free trial: the account is made now; the first invoice comes at its end.
    const f = companyFieldsFromSubscription(sub);
    const result = await provisionCompany({
      companyName: company,
      ownerName: name,
      ownerEmail: email,
      planId: plan.id as string,
      status: f.status,
      trialEndsAt: f.trial_ends_at,
      currentPeriodEnd: f.current_period_end,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      origin,
    });
    if (!result.ok) {
      await stripe.subscriptions.cancel(sub.id).catch(() => {});
      await stripe.customers.del(customerId).catch(() => {});
      return NextResponse.json({ ok: false, error: result.error === "email_in_use" ? "email_in_use" : "create_failed" });
    }
    return NextResponse.json({ ok: true, url: `${origin}/signup/done` });
  }

  // No trial: pay the first invoice now (card typed in, not saved). The
  // account is made when Stripe confirms it paid (platform webhook, invoice.paid).
  try {
    const invoiceId = typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id;
    let invoice = await stripe.invoices.retrieve(invoiceId as string);
    if (invoice.status === "draft") invoice = await stripe.invoices.finalizeInvoice(invoice.id as string);
    if (!invoice.hosted_invoice_url) throw new Error("no hosted invoice page");
    return NextResponse.json({ ok: true, url: invoice.hosted_invoice_url });
  } catch (err) {
    console.error("[signup] first invoice failed", err);
    await stripe.subscriptions.cancel(sub.id).catch(() => {});
    await stripe.customers.del(customerId).catch(() => {});
    return NextResponse.json({ ok: false, error: "payment_provider_error" });
  }
}

/** Days a company has to pay each monthly invoice before it counts as overdue. */
const DAYS_TO_PAY = 7;
