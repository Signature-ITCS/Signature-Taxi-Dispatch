import { NextResponse } from "next/server";
import { getPlatformAdmin } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformStripe } from "@/lib/stripe";
import { invoiceRow, type InvoiceRow } from "@/lib/invoices";

/**
 * Every company's subscription invoices from the last 13 months (platform
 * owner), with the company each belongs to and the totals: collected this
 * month, outstanding, overdue.
 */
export async function GET() {
  if (!(await getPlatformAdmin())) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const stripe = await getPlatformStripe();
  if (!stripe) return NextResponse.json({ ok: false, error: "stripe_not_configured" });

  const { data: companies } = await createAdminClient().from("companies").select("id, name, slug, status, stripe_customer_id");
  const byCustomer = new Map(
    (companies ?? []).filter((c) => c.stripe_customer_id).map((c) => [c.stripe_customer_id as string, { id: c.id, name: c.name, slug: c.slug, status: c.status }])
  );

  const since = Math.floor(Date.now() / 1000) - 400 * 24 * 60 * 60;
  const rows: (InvoiceRow & { company: { id: string; name: string; slug: string; status: string } | null })[] = [];
  try {
    for await (const inv of stripe.invoices.list({ limit: 100, created: { gte: since } })) {
      const r = invoiceRow(inv);
      if (r) rows.push({ ...r, company: (r.customer && byCustomer.get(r.customer)) || null });
      if (rows.length >= 2000) break;
    }
  } catch (err) {
    console.error("[master/billing] failed", err);
    return NextResponse.json({ ok: false, error: "stripe_error" });
  }

  // "This month" in UK time.
  const ukMonth = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "2-digit", year: "numeric", timeZone: "Europe/London" });
  const thisMonth = ukMonth(new Date().toISOString());
  const unpaid = rows.filter((r) => r.status === "due" || r.status === "overdue");
  const overdue = rows.filter((r) => r.status === "overdue");
  const totals = {
    collected_this_month: rows.filter((r) => r.paid_at && ukMonth(r.paid_at) === thisMonth).reduce((n, r) => n + r.amount_paid, 0),
    outstanding: unpaid.reduce((n, r) => n + r.amount_remaining, 0),
    unpaid_count: unpaid.length,
    overdue_amount: overdue.reduce((n, r) => n + r.amount_remaining, 0),
    overdue_count: overdue.length,
    overdue_companies: new Set(overdue.map((r) => r.company?.id ?? r.customer)).size,
  };
  return NextResponse.json({ ok: true, invoices: rows, totals });
}
