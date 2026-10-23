import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getPlatformStripe, platformWebhookSecret } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { provisionCompany, notifyOwner, siteOrigin } from "@/lib/provision";
import { companyFieldsFromSubscription } from "@/lib/billing";
import { audit } from "@/lib/tenant";

/**
 * The PLATFORM's Stripe webhook — companies' subscriptions and one-off
 * payments to the platform owner (setup help, paid restores).
 *
 * Setup (master dashboard → Settings shows the URL): Stripe Dashboard →
 * Developers → Webhooks → add https://<platform>/api/platform/stripe-webhook,
 * events checkout.session.completed, customer.subscription.updated,
 * customer.subscription.deleted, invoice.payment_failed — and save the signing
 * secret in the master dashboard.
 *
 * Every handler is idempotent: Stripe retries deliveries for days.
 */
export async function POST(req: Request) {
  const stripe = await getPlatformStripe();
  const secret = await platformWebhookSecret();
  if (!stripe || !secret) {
    console.error("[platform-webhook] platform Stripe key / webhook secret not set");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ ok: false, error: "no_signature" }, { status: 400 });
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
  } catch (err) {
    console.error("[platform-webhook] bad signature", err);
    return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 400 });
  }

  const origin = siteOrigin(new URL(req.url).origin);
  try {
    switch (event.type) {
      case "checkout.session.completed":
        await onCheckoutCompleted(stripe, event.data.object, origin);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await onSubscriptionChanged(event.data.object);
        break;
      case "invoice.payment_failed":
        await onPaymentFailed(event.data.object, origin);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error(`[platform-webhook] ${event.type} failed`, err);
    return NextResponse.json({ ok: false, error: "handler_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

async function onCheckoutCompleted(stripe: Stripe, session: Stripe.Checkout.Session, origin: string) {
  const meta = session.metadata ?? {};
  const admin = createAdminClient();

  if (meta.kind === "signup" && session.mode === "subscription" && session.subscription) {
    const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
    const sub = await stripe.subscriptions.retrieve(subId);
    const f = companyFieldsFromSubscription(sub);
    const email = session.customer_details?.email ?? session.customer_email ?? "";
    const result = await provisionCompany({
      companyName: meta.company_name ?? "",
      ownerName: meta.full_name ?? "",
      ownerEmail: email,
      planId: meta.plan_id ?? "",
      status: f.status,
      trialEndsAt: f.trial_ends_at,
      currentPeriodEnd: f.current_period_end,
      stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
      stripeSubscriptionId: subId,
      origin,
    });
    if (!result.ok) {
      // Paid, but no account — never silent.
      await notifyOwner(
        "Signup paid but the account could not be created",
        [
          ["Company", meta.company_name ?? ""],
          ["Email", email],
          ["Problem", result.error],
          ["Stripe subscription", subId],
        ],
        `${origin}/master/companies`
      );
      if (result.error !== "email_in_use") throw new Error(`provision failed: ${result.error}`);
    }
    return;
  }

  // One-off payments: setup help or a paid restore.
  if ((meta.kind === "setup" || meta.kind === "restore") && session.payment_status === "paid" && meta.request_id) {
    const table = meta.kind === "setup" ? "setup_requests" : "restore_requests";
    await admin.from(table).update({ paid: true, updated_at: new Date().toISOString() }).eq("id", meta.request_id);
    await audit(`${meta.kind}_paid`, { companyId: meta.company_id ?? null, detail: { request: meta.request_id } });
  }
}

async function onSubscriptionChanged(sub: Stripe.Subscription) {
  const admin = createAdminClient();
  const { data: company } = await admin
    .from("companies")
    .select("id, status, plan_id")
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();
  if (!company) return; // created by checkout.session.completed; nothing to update yet

  const f = companyFieldsFromSubscription(sub);
  const patch: Record<string, unknown> = {
    status: f.status,
    trial_ends_at: f.trial_ends_at,
    current_period_end: f.current_period_end,
    updated_at: new Date().toISOString(),
  };
  // Plan changed in the billing portal → follow it.
  if (f.stripe_price_id) {
    const { data: plan } = await admin.from("plans").select("id").eq("stripe_price_id", f.stripe_price_id).maybeSingle();
    if (plan && plan.id !== company.plan_id) patch.plan_id = plan.id;
  }
  await admin.from("companies").update(patch).eq("id", company.id);
  if (company.status !== f.status || patch.plan_id) {
    await audit("subscription_changed", { companyId: company.id as string, detail: { from: company.status, to: f.status, plan: patch.plan_id ?? null } });
  }
}

async function onPaymentFailed(invoice: Stripe.Invoice, origin: string) {
  const customer = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customer) return;
  const { data: company } = await createAdminClient()
    .from("companies")
    .select("id, name")
    .eq("stripe_customer_id", customer)
    .maybeSingle();
  if (!company) return;
  await notifyOwner(
    `Payment failed: ${company.name}`,
    [
      ["Company", String(company.name)],
      ["Amount due", `${((invoice.amount_due ?? 0) / 100).toFixed(2)} ${String(invoice.currency ?? "").toUpperCase()}`],
    ],
    `${origin}/master/companies`
  );
}
