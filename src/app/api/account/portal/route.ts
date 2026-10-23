import { NextResponse } from "next/server";
import { getStaffContext } from "@/lib/tenant";
import { getPlatformStripe } from "@/lib/stripe";
import { siteOrigin } from "@/lib/provision";

/**
 * Open Stripe's billing portal for the company's subscription: change plan,
 * update the card, see invoices, cancel. Admins only — and it works while the
 * company is suspended, since that is how they pay to unlock it.
 */
export async function POST(req: Request) {
  const ctx = await getStaffContext();
  if (!ctx || ctx.profile.role !== "admin" || !ctx.profile.is_active) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }
  if (!ctx.company.stripe_customer_id) return NextResponse.json({ ok: false, error: "no_billing_account" });
  const stripe = await getPlatformStripe();
  if (!stripe) return NextResponse.json({ ok: false, error: "billing_unavailable" });
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: ctx.company.stripe_customer_id,
      return_url: `${siteOrigin(new URL(req.url).origin)}/account`,
    });
    return NextResponse.json({ ok: true, url: session.url });
  } catch (err) {
    console.error("[portal] failed", err);
    return NextResponse.json({ ok: false, error: "billing_unavailable" });
  }
}
