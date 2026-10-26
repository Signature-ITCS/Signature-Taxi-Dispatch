import { NextResponse } from "next/server";
import { getStaffContext } from "@/lib/tenant";
import { getPlatformStripe } from "@/lib/stripe";
import { invoiceRow, type InvoiceRow } from "@/lib/invoices";

/**
 * The company's own subscription invoices — paid, due, overdue — with Stripe's
 * pay page and PDF for each. Admins only; works while the company is suspended
 * (paying is how it is unlocked). Only invoices of the company's own Stripe
 * customer are ever listed.
 */
export async function GET() {
  const ctx = await getStaffContext();
  if (!ctx || ctx.profile.role !== "admin" || !ctx.profile.is_active) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }
  const customer = ctx.company.stripe_customer_id;
  if (!customer) return NextResponse.json({ ok: true, invoices: [] });
  const stripe = await getPlatformStripe();
  if (!stripe) return NextResponse.json({ ok: false, error: "billing_unavailable" });
  try {
    const list = await stripe.invoices.list({ customer, limit: 36 });
    const invoices = list.data.map((i) => invoiceRow(i)).filter((r): r is InvoiceRow => !!r);
    return NextResponse.json({ ok: true, invoices });
  } catch (err) {
    console.error("[account/invoices] failed", err);
    return NextResponse.json({ ok: false, error: "billing_unavailable" });
  }
}
