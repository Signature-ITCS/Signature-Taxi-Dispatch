import { NextResponse } from "next/server";
import { getPlatformAdmin, audit } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInvoices, withState, type PlatformInvoice } from "@/lib/billing";

/**
 * Companies' subscription invoices (platform owner). Billed by hand: the owner
 * sends each payment link by email or WhatsApp and marks the invoice sent,
 * then paid — so nobody is asked twice. Nothing here touches Stripe.
 */

export async function GET() {
  if (!(await getPlatformAdmin())) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  // Anything due in the coming week that isn't on the list yet.
  await generateInvoices(7).catch((err) => console.error("[master/billing] generate failed", err));

  const admin = createAdminClient();
  const [{ data: invoices }, { data: companies }] = await Promise.all([
    admin.from("platform_invoices").select("*").neq("status", "cancelled").order("due_date", { ascending: false }).limit(1000),
    admin.from("companies").select("id, name, slug, status, owner_email, owner_phone, billing_paused"),
  ]);
  const byId = new Map((companies ?? []).map((c) => [c.id as string, c]));

  const rows = ((invoices ?? []) as PlatformInvoice[]).map(withState).map((i) => ({ ...i, company: byId.get(i.company_id) ?? null }));
  const ukMonth = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }).slice(0, 7);
  const sum = (xs: typeof rows) => xs.reduce((n, r) => n + r.amount, 0);
  const toSend = rows.filter((r) => r.state === "upcoming" || (r.status === "upcoming" && r.state === "overdue"));
  const waiting = rows.filter((r) => r.status === "sent");
  const overdue = rows.filter((r) => r.state === "overdue");
  const paidThisMonth = rows.filter((r) => r.status === "paid" && r.paid_at && new Date(r.paid_at).toLocaleDateString("en-CA", { timeZone: "Europe/London" }).slice(0, 7) === ukMonth);
  return NextResponse.json({
    ok: true,
    invoices: rows,
    totals: {
      to_send: toSend.length,
      to_send_amount: sum(toSend),
      waiting: waiting.length,
      waiting_amount: sum(waiting),
      overdue: overdue.length,
      overdue_amount: sum(overdue),
      paid_this_month: paidThisMonth.length,
      paid_this_month_amount: sum(paidThisMonth),
    },
  });
}

/**
 * { id, action } where action is
 *   "sent"      { via?: "email"|"whatsapp"|"other", payment_link? }
 *   "unsent"    back to upcoming
 *   "paid"      { paid_at?: "YYYY-MM-DD", note? }
 *   "unpaid"    undo paid
 *   "cancel"    remove it (a fresh one for the same period is made at today's plan price)
 *   "edit"      { amount?, payment_link?, notes?, due_date? }
 */
export async function POST(req: Request) {
  const owner = await getPlatformAdmin();
  if (!owner) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof b.id === "string" ? b.id : "";
  const action = String(b.action ?? "");
  const admin = createAdminClient();
  const { data: inv } = await admin.from("platform_invoices").select("id, company_id, number, status").eq("id", id).maybeSingle();
  if (!inv) return NextResponse.json({ ok: false, error: "not_found" });
  const now = new Date().toISOString();
  const link = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";
    return /^https:\/\/\S{4,500}$/.test(s) ? s : null;
  };

  let error: { message: string } | null = null;
  switch (action) {
    case "sent": {
      if (inv.status === "paid" || inv.status === "cancelled") return NextResponse.json({ ok: false, error: "not_open" });
      const via = ["email", "whatsapp", "other"].includes(String(b.via)) ? String(b.via) : "other";
      if (b.payment_link && !link(b.payment_link)) return NextResponse.json({ ok: false, error: "invalid_link" });
      ({ error } = await admin.from("platform_invoices")
        .update({ status: "sent", sent_at: now, sent_via: via, ...(b.payment_link ? { payment_link: link(b.payment_link) } : {}), updated_at: now })
        .eq("id", id));
      break;
    }
    case "unsent":
      if (inv.status !== "sent") return NextResponse.json({ ok: false, error: "not_sent" });
      ({ error } = await admin.from("platform_invoices").update({ status: "upcoming", sent_at: null, sent_via: null, updated_at: now }).eq("id", id));
      break;
    case "paid": {
      const d = typeof b.paid_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.paid_at) ? `${b.paid_at}T12:00:00Z` : now;
      const { data, error: e } = await admin.rpc("platform_mark_invoice_paid", {
        p_invoice: id,
        p_paid_at: d,
        p_note: typeof b.note === "string" ? b.note.slice(0, 300) : null,
      });
      if (e || !(data as { ok?: boolean })?.ok) return NextResponse.json({ ok: false, error: (data as { error?: string })?.error ?? "save_failed" });
      break;
    }
    case "unpaid": {
      const { data, error: e } = await admin.rpc("platform_unmark_invoice_paid", { p_invoice: id });
      if (e || !(data as { ok?: boolean })?.ok) return NextResponse.json({ ok: false, error: "not_paid" });
      break;
    }
    case "cancel":
      if (inv.status === "paid") return NextResponse.json({ ok: false, error: "already_paid" });
      ({ error } = await admin.from("platform_invoices").update({ status: "cancelled", updated_at: now }).eq("id", id));
      break;
    case "edit": {
      const patch: Record<string, unknown> = { updated_at: now };
      if (b.amount !== undefined) {
        const a = Number(b.amount);
        if (!Number.isFinite(a) || a < 0 || a > 100000) return NextResponse.json({ ok: false, error: "invalid_amount" });
        if (inv.status === "paid") return NextResponse.json({ ok: false, error: "already_paid" });
        patch.amount = Math.round(a * 100) / 100;
      }
      if (b.payment_link !== undefined) {
        if (b.payment_link && !link(b.payment_link)) return NextResponse.json({ ok: false, error: "invalid_link" });
        patch.payment_link = link(b.payment_link);
      }
      if (typeof b.notes === "string") patch.notes = b.notes.slice(0, 1000) || null;
      if (typeof b.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.due_date)) patch.due_date = b.due_date;
      ({ error } = await admin.from("platform_invoices").update(patch).eq("id", id));
      break;
    }
    default:
      return NextResponse.json({ ok: false, error: "bad_action" });
  }
  if (error) {
    console.error("[master/billing] update failed", error);
    return NextResponse.json({ ok: false, error: "save_failed" });
  }
  // A cancelled invoice is replaced straight away by a fresh one for the same period.
  if (action === "cancel") await generateInvoices(7).catch(() => 0);
  await audit(`invoice_${action}`, { actorId: owner.userId, actorEmail: owner.email, companyId: inv.company_id as string, detail: { invoice: inv.number } });
  return NextResponse.json({ ok: true });
}
