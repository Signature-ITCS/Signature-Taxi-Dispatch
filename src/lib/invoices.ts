import type Stripe from "stripe";

/**
 * Companies' subscription invoices (the platform owner's Stripe), shaped for
 * the screens. Server-only. Read live from Stripe — never stored here.
 */

export type InvoiceStatus = "paid" | "due" | "overdue" | "void" | "uncollectible";

export interface InvoiceRow {
  id: string;
  number: string | null;
  customer: string | null;
  /** ISO times */
  created: string;
  due_date: string | null;
  paid_at: string | null;
  period_start: string | null;
  period_end: string | null;
  /** Pounds (or the invoice's currency), not pence. */
  amount: number;
  amount_paid: number;
  amount_remaining: number;
  currency: string;
  status: InvoiceStatus;
  /** Stripe's page where the invoice is paid (card typed in, not saved). */
  pay_url: string | null;
  pdf_url: string | null;
}

const iso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);

/** A Stripe invoice → a row; drafts (not yet sent) are left out. */
export function invoiceRow(inv: Stripe.Invoice, now = Date.now()): InvoiceRow | null {
  if (!inv.id || inv.status === "draft" || !inv.status) return null;
  let status: InvoiceStatus;
  if (inv.status === "paid") status = "paid";
  else if (inv.status === "open") status = inv.due_date && inv.due_date * 1000 < now ? "overdue" : "due";
  else status = inv.status;
  const line = inv.lines?.data?.[0];
  return {
    id: inv.id,
    number: inv.number ?? null,
    customer: typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? null,
    created: iso(inv.created) as string,
    due_date: iso(inv.due_date),
    paid_at: iso(inv.status_transitions?.paid_at),
    period_start: iso(line?.period?.start ?? inv.period_start),
    period_end: iso(line?.period?.end ?? inv.period_end),
    amount: (inv.total ?? 0) / 100,
    amount_paid: (inv.amount_paid ?? 0) / 100,
    amount_remaining: (inv.amount_remaining ?? 0) / 100,
    currency: inv.currency ?? "gbp",
    status,
    pay_url: status === "due" || status === "overdue" ? inv.hosted_invoice_url ?? null : null,
    pdf_url: inv.invoice_pdf ?? null,
  };
}
