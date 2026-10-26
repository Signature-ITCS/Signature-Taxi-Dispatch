import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Companies' subscriptions to the platform. Server-only.
 *
 * Billed by hand: the platform keeps its own invoices (platform_invoices,
 * db/2026-10-27_manual_billing.sql). The owner sends a payment link for each
 * by email or WhatsApp and marks it sent, then paid. No card is ever saved or
 * charged by the platform.
 */

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_monthly: number;
  currency: string;
  max_drivers: number | null;
  max_staff: number | null;
  max_bookings_month: number | null;
  backups_included: boolean;
  features: string[];
  trial_days: number;
  is_public: boolean;
  is_active: boolean;
  sort_order: number;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
}

export async function listPlans(opts: { publicOnly?: boolean } = {}): Promise<Plan[]> {
  let q = createAdminClient().from("plans").select("*").order("sort_order");
  if (opts.publicOnly) q = q.eq("is_public", true).eq("is_active", true);
  const { data } = await q;
  return (data ?? []) as Plan[];
}

/** A subscription invoice as the screens show it. */
export type InvoiceState = "upcoming" | "sent" | "overdue" | "paid" | "cancelled";

export interface PlatformInvoice {
  id: string;
  company_id: string;
  number: string;
  plan_name: string | null;
  amount: number;
  currency: string;
  period_start: string;
  period_end: string;
  due_date: string;
  status: "upcoming" | "sent" | "paid" | "cancelled";
  /** status, with "overdue" for an unpaid one past its due date (UK). */
  state: InvoiceState;
  sent_at: string | null;
  sent_via: string | null;
  payment_link: string | null;
  paid_at: string | null;
  paid_note: string | null;
  notes: string | null;
  created_at: string;
}

const ukToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

export function withState<T extends { status: string; due_date: string; amount: unknown }>(row: T): T & { state: InvoiceState; amount: number } {
  const unpaid = row.status === "upcoming" || row.status === "sent";
  const state = (unpaid && row.due_date < ukToday() ? "overdue" : row.status) as InvoiceState;
  return { ...row, amount: Number(row.amount), state };
}

/** One company's invoices, newest first (cancelled ones left out). */
export async function companyInvoices(companyId: string): Promise<PlatformInvoice[]> {
  const { data } = await createAdminClient()
    .from("platform_invoices")
    .select("*")
    .eq("company_id", companyId)
    .neq("status", "cancelled")
    .order("period_start", { ascending: false })
    .limit(36);
  return ((data ?? []) as PlatformInvoice[]).map(withState);
}

/** Add the invoices due within the next days (daily cron; also after changes). */
export async function generateInvoices(daysAhead = 7): Promise<number> {
  const { data, error } = await createAdminClient().rpc("platform_generate_invoices", { p_days_ahead: daysAhead });
  if (error) throw new Error(error.message);
  return Number(data) || 0;
}
