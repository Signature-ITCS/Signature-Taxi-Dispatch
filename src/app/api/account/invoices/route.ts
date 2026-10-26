import { NextResponse } from "next/server";
import { getStaffContext } from "@/lib/tenant";
import { companyInvoices } from "@/lib/billing";

/**
 * The company's own subscription invoices (upcoming, payment link sent,
 * overdue, paid). Admins only; works while the company is suspended — paying
 * is how it is unlocked. Read with the service role, filtered to the
 * signed-in admin's company.
 */
export async function GET() {
  const ctx = await getStaffContext();
  if (!ctx || ctx.profile.role !== "admin" || !ctx.profile.is_active) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }
  const invoices = (await companyInvoices(ctx.company.id)).map((i) => ({
    id: i.id,
    number: i.number,
    plan_name: i.plan_name,
    amount: i.amount,
    currency: i.currency,
    period_start: i.period_start,
    period_end: i.period_end,
    due_date: i.due_date,
    state: i.state,
    sent_at: i.sent_at,
    paid_at: i.paid_at,
    // The link we sent them, so they can find it again.
    payment_link: i.state === "paid" ? null : i.payment_link,
  }));
  return NextResponse.json({ ok: true, invoices });
}
