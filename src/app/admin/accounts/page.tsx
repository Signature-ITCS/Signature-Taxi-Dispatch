"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Building2,
  Plus,
  Search,
  Loader2,
  X,
  Mail,
  Phone,
  MapPin,
  Navigation,
  User,
  FileDown,
  Send,
  CheckCircle2,
  Pencil,
  StickyNote,
  Receipt,
  CircleDot,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import PageHeader from "@/components/admin/PageHeader";
import StatusBadge from "@/components/dashboard/StatusBadge";
import LoadError from "@/components/dashboard/LoadError";
import SheetHandle from "@/components/dashboard/SheetHandle";
import { cn, money, dateOnly, dateTime } from "@/lib/format";
import {
  accountJourneys,
  billable,
  currentMonth,
  journeyFare,
  journeyTime,
  monthRange,
  recentMonths,
  type InvoiceJourney,
} from "@/lib/accountJourneys";
import type { Account, BookingStatus, Invoice } from "@/lib/types";

/**
 * Corporate accounts. Journeys booked "on account" (New booking → Account) are
 * collected here month by month; each month's invoice can be downloaded as a
 * PDF or emailed, and goes out automatically on the 1st of the next month.
 */
export default function AccountsPage() {
  const supabase = createClient();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [monthTotals, setMonthTotals] = useState<Record<string, { n: number; total: number }>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [detail, setDetail] = useState<Account | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("accounts").select("*").order("name");
    if (error) console.error("[accounts] load failed", error);
    setLoadError(error?.message ?? null);
    setAccounts((data as Account[]) ?? []);
    setLoading(false);

    // This month so far, for every account, in one query.
    const { from, to } = monthRange(currentMonth());
    const f = from.toISOString();
    const t = to.toISOString();
    const { data: js } = await supabase
      .from("bookings")
      .select("account_id, status, final_fare, estimated_fare")
      .eq("payment_method", "account")
      .not("account_id", "is", null)
      .or(`and(scheduled_at.gte.${f},scheduled_at.lt.${t}),and(scheduled_at.is.null,created_at.gte.${f},created_at.lt.${t})`)
      .limit(5000);
    const totals: Record<string, { n: number; total: number }> = {};
    for (const j of (js as { account_id: string; status: string; final_fare: number | null; estimated_fare: number | null }[]) ?? []) {
      if (j.status !== "completed") continue;
      const r = (totals[j.account_id] ??= { n: 0, total: 0 });
      r.n += 1;
      r.total += journeyFare(j);
    }
    setMonthTotals(totals);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const term = q.trim().toLowerCase();
  const shown = term
    ? accounts.filter((a) => [a.name, a.contact_name, a.email, a.phone].some((v) => v?.toLowerCase().includes(term)))
    : accounts;

  return (
    <div>
      <PageHeader
        title="Accounts"
        subtitle="Corporate customers: journeys on account, invoiced monthly"
        action={
          <button
            onClick={() => setEditing("new")}
            className="flex items-center gap-1.5 rounded-xl bg-brand-500 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
          >
            <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New account</span>
            <span className="sm:hidden">New</span>
          </button>
        }
      />
      {loadError && (
        <div className="px-5 pb-4 md:px-8">
          <LoadError what="accounts" detail={loadError} onRetry={load} />
        </div>
      )}
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-brand-600" />
        </div>
      ) : (
        <div className="px-5 pb-10 md:px-8">
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search accounts by name, contact, email or phone…"
              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-base outline-none focus:border-brand-400 md:text-sm"
            />
          </div>
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            {shown.length === 0 && (
              <div className="py-12 text-center text-sm text-gray-400">
                <Building2 className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                {term ? "No account matches" : "No accounts yet. Add your first corporate customer."}
              </div>
            )}
            {shown.map((a, i) => {
              const t = monthTotals[a.id];
              return (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.04, 0.3) }}
                  onClick={() => setDetail(a)}
                  className="flex cursor-pointer items-center justify-between gap-3 border-b border-gray-50 px-4 py-3.5 last:border-0 hover:bg-gray-50/60 sm:px-5 sm:py-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-semibold text-ink-950">
                        <span className="truncate">{a.name}</span>
                        {!a.is_active && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">Inactive</span>}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-gray-400">
                        {a.contact_name && <span>{a.contact_name}</span>}
                        <span className="flex max-w-full items-center gap-1">
                          <Mail className="h-3 w-3 shrink-0" />
                          <span className="truncate">{a.email || "No invoice email"}</span>
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-sm font-bold text-ink-950">{money(t?.total ?? 0)}</p>
                    <p className="text-[11px] text-gray-400">
                      {t?.n ?? 0} journey{t?.n === 1 ? "" : "s"} this month
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {editing && (
        <AccountForm
          account={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(a) => {
            setEditing(null);
            load();
            if (detail && detail.id === a.id) setDetail(a);
          }}
        />
      )}
      {detail && !editing && <AccountDetail account={detail} onClose={() => setDetail(null)} onEdit={() => setEditing(detail)} />}
    </div>
  );
}

/* ───────────────────────────── create / edit ───────────────────────────── */

function AccountForm({ account, onClose, onSaved }: { account: Account | null; onClose: () => void; onSaved: (a: Account) => void }) {
  const supabase = createClient();
  const [f, setF] = useState({
    name: account?.name ?? "",
    contact_name: account?.contact_name ?? "",
    email: account?.email ?? "",
    phone: account?.phone ?? "",
    address: account?.address ?? "",
    notes: account?.notes ?? "",
    is_active: account?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const emailsOk = f.email
    .split(/[,;\s]+/)
    .filter(Boolean)
    .every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

  const save = async () => {
    if (!f.name.trim()) return setErr("The company name is required.");
    if (!emailsOk) return setErr("Check the invoice email address.");
    setSaving(true);
    setErr(null);
    const row = {
      name: f.name.trim(),
      contact_name: f.contact_name.trim() || null,
      email: f.email.trim() || null,
      phone: f.phone.trim() || null,
      address: f.address.trim() || null,
      notes: f.notes.trim() || null,
      is_active: f.is_active,
      updated_at: new Date().toISOString(),
    };
    const q = account ? supabase.from("accounts").update(row).eq("id", account.id) : supabase.from("accounts").insert(row);
    const { data, error } = await q.select("*").single();
    setSaving(false);
    if (error) {
      console.error("[accounts] save failed", error);
      return setErr("Could not save the account. Please try again.");
    }
    onSaved(data as Account);
  };

  return (
    <Sheet onClose={onClose} title={account ? "Edit account" : "New account"} subtitle="Invoices are emailed to the invoice email">
      <div className="space-y-3">
        <Input label="Company name *" value={f.name} onChange={set("name")} placeholder="e.g. Sheerness Port Services Ltd" />
        <Input label="Contact name" value={f.contact_name} onChange={set("contact_name")} placeholder="Who books and pays" />
        <Input
          label="Invoice email"
          value={f.email}
          onChange={set("email")}
          placeholder="accounts@company.co.uk (several: separate with commas)"
          type="email"
          error={!emailsOk ? "Please enter a valid email address." : null}
        />
        <Input label="Phone" value={f.phone} onChange={set("phone")} placeholder="Filled in as the passenger phone when booking" type="tel" />
        <Textarea label="Billing address" value={f.address} onChange={set("address")} placeholder={"Street\nTown\nPostcode"} />
        <Textarea label="Notes (staff only)" value={f.notes} onChange={set("notes")} placeholder="e.g. PO number required, regular passengers" />
        <label className="flex items-center gap-2.5 rounded-xl border border-gray-200 px-3.5 py-3 text-sm font-medium">
          <input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active")(e.target.checked)} className="h-4 w-4 accent-brand-500" />
          Active (can be chosen for new bookings and is invoiced monthly)
        </label>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button
          onClick={save}
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 py-3 text-sm font-bold text-white hover:bg-brand-600 disabled:bg-gray-200 disabled:text-gray-400"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : account ? "Save changes" : "Create account"}
        </button>
      </div>
    </Sheet>
  );
}

/* ───────────────────────────── account detail ───────────────────────────── */

function AccountDetail({ account, onClose, onEdit }: { account: Account; onClose: () => void; onEdit: () => void }) {
  const supabase = createClient();
  const months = recentMonths(12);
  const [month, setMonth] = useState(months[0]);
  const [journeys, setJourneys] = useState<InvoiceJourney[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"send" | "paid" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setJourneys(null);
    setErr(null);
    try {
      setJourneys(await accountJourneys(supabase, account.id, month));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
      setJourneys([]);
    }
    const { data } = await supabase.from("invoices").select("*").eq("account_id", account.id).order("period_start", { ascending: false });
    setInvoices((data as Invoice[]) ?? []);
  }, [supabase, account.id, month]);

  useEffect(() => {
    setMsg(null);
    load();
  }, [load]);

  const range = monthRange(month);
  const invoice = invoices.find((i) => i.period_start === range.periodStart) ?? null;
  const billed = billable(journeys ?? []);
  const others = (journeys ?? []).filter((j) => j.status !== "completed");
  const total = billed.reduce((s, j) => s + journeyFare(j), 0);
  const pdfUrl = (m: string) => `/api/accounts/invoice?account=${account.id}&month=${m}`;

  const send = async () => {
    setBusy("send");
    setMsg(null);
    const res = await fetch("/api/accounts/invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: account.id, month, send: true }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(null);
    if (data?.error === "no_journeys") setMsg({ ok: false, text: "There are no completed journeys to invoice for this month." });
    else if (data?.ok) setMsg({ ok: true, text: `Invoice ${data.invoice.invoice_number} emailed to ${account.email}.` });
    else setMsg({ ok: false, text: data?.invoice ? `Invoice ${data.invoice.invoice_number} saved, but the email failed: ${data.error}` : `Could not send: ${data?.error ?? "network error"}` });
    load();
  };

  const markPaid = async (inv: Invoice) => {
    setBusy("paid");
    const paidAt = new Date().toISOString();
    const { error } = await supabase.from("invoices").update({ paid_at: paidAt }).eq("id", inv.id);
    if (!error && inv.booking_ids.length) {
      await supabase.from("bookings").update({ payment_status: "paid" }).in("id", inv.booking_ids);
    }
    setBusy(null);
    setMsg(error ? { ok: false, text: "Could not mark the invoice paid." } : { ok: true, text: `${inv.invoice_number} marked as paid.` });
    load();
  };

  return (
    <Sheet onClose={onClose} title={account.name} subtitle={account.is_active ? "Corporate account" : "Inactive account"} wide>
      {/* Contact */}
      <div className="mb-4 space-y-2 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5">
        <Row icon={User} label="Contact" value={account.contact_name || "—"} />
        <Row icon={Mail} label="Invoices" value={account.email || "No invoice email: add one to email invoices"} warn={!account.email} />
        <Row icon={Phone} label="Phone" value={account.phone || "—"} />
        <Row icon={MapPin} label="Address" value={account.address || "—"} />
        {account.notes && <Row icon={StickyNote} label="Notes" value={account.notes} />}
        <button onClick={onEdit} className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700">
          <Pencil className="h-3.5 w-3.5" /> Edit account
        </button>
      </div>

      {/* Month */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-brand-400"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {monthRange(m).label}
            </option>
          ))}
        </select>
        {invoice ? (
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", invoice.paid_at ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800")}>
            {invoice.invoice_number} · {invoice.paid_at ? `paid ${dateOnly(invoice.paid_at)}` : invoice.emailed_at ? `emailed ${dateOnly(invoice.emailed_at)}` : "issued, not emailed"}
          </span>
        ) : (
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500">Not invoiced yet</span>
        )}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2.5">
        <Stat label="Completed journeys" value={journeys ? String(billed.length) : "…"} />
        <Stat label="To invoice" value={journeys ? money(total) : "…"} />
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <a
          href={pdfUrl(month)}
          className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-semibold text-ink-950 hover:bg-gray-50"
        >
          <FileDown className="h-4 w-4" /> {invoice ? "Download invoice (PDF)" : "Download draft (PDF)"}
        </a>
        <button
          onClick={send}
          disabled={busy !== null || !account.email || billed.length === 0}
          className="flex items-center justify-center gap-2 rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:bg-gray-200 disabled:text-gray-400"
          title={!account.email ? "Add an invoice email first" : undefined}
        >
          {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {invoice?.emailed_at ? "Email invoice again" : "Issue & email invoice"}
        </button>
        {invoice && !invoice.paid_at && (
          <button
            onClick={() => markPaid(invoice)}
            disabled={busy !== null}
            className="flex items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 py-2.5 text-sm font-semibold text-green-700 hover:bg-green-100 sm:col-span-2"
          >
            {busy === "paid" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Mark {invoice.invoice_number} as paid
          </button>
        )}
      </div>
      {msg && <p className={cn("mb-4 rounded-xl px-3 py-2.5 text-sm", msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700")}>{msg.text}</p>}
      {invoice?.email_error && !msg && <p className="mb-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">Last email failed: {invoice.email_error}</p>}

      {/* Journeys */}
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">Journeys in {range.label}</p>
      {journeys === null ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
        </div>
      ) : err ? (
        <LoadError what="this account's journeys" detail={err} />
      ) : journeys.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">No journeys on this account this month.</p>
      ) : (
        <div className="space-y-2">
          {[...billed, ...others].map((j) => (
            <div key={j.id} className={cn("rounded-xl border p-3", j.status === "completed" ? "border-gray-100" : "border-dashed border-gray-200 bg-gray-50/50")}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-gray-500">{j.booking_number}</span>
                  <StatusBadge status={j.status as BookingStatus} size="xs" />
                </span>
                <span className="font-display text-sm font-bold text-ink-950">{money(journeyFare(j))}</span>
              </div>
              <p className="text-xs font-medium text-ink-950">
                {dateTime(journeyTime(j))} · {j.customer_name}
              </p>
              <p className="flex items-center gap-1.5 text-xs text-ink-950">
                <MapPin className="h-3 w-3 shrink-0 text-brand-500" />
                <span className="truncate">{j.pickup_address}</span>
              </p>
              <p className="flex items-center gap-1.5 text-xs text-gray-500">
                <Navigation className="h-3 w-3 shrink-0 text-gray-400" />
                <span className="truncate">{j.dropoff_address}</span>
              </p>
            </div>
          ))}
          {others.length > 0 && (
            <p className="flex items-center gap-1.5 pt-1 text-xs text-gray-500">
              <CircleDot className="h-3.5 w-3.5" /> Journeys not completed (dashed) aren&apos;t invoiced.
            </p>
          )}
        </div>
      )}

      {/* Past invoices */}
      {invoices.length > 0 && (
        <>
          <p className="mb-2 mt-6 text-xs font-bold uppercase tracking-wide text-gray-400">Invoices</p>
          <div className="overflow-hidden rounded-xl border border-gray-100">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-2 border-b border-gray-50 px-3 py-2.5 text-sm last:border-0">
                <span className="flex min-w-0 items-center gap-2">
                  <Receipt className="h-4 w-4 shrink-0 text-gray-400" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink-950">
                      {inv.invoice_number} · {monthRange(inv.period_start.slice(0, 7)).label}
                    </span>
                    <span className="block text-xs text-gray-400">
                      {inv.journeys} journeys · {inv.paid_at ? "paid" : inv.emailed_at ? "emailed" : "not emailed"}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-display font-bold">{money(Number(inv.total))}</span>
                  <a href={pdfUrl(inv.period_start.slice(0, 7))} title="Download PDF" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
                    <FileDown className="h-4 w-4" />
                  </a>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ───────────────────────────── bits ───────────────────────────── */

function Sheet({
  title,
  subtitle,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-xl sm:max-h-[90vh] sm:rounded-2xl sm:p-6",
          wide ? "sm:max-w-2xl" : "sm:max-w-lg"
        )}
      >
        <SheetHandle />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-lg font-bold leading-tight text-ink-950">{title}</p>
              {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-base outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 md:text-sm";

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  error?: string | null;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
      {error && <span className="mt-1 block text-xs text-red-500">{error}</span>}
    </label>
  );
}

function Textarea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className={inputCls} />
    </label>
  );
}

function Row({ icon: Icon, label, value, warn = false }: { icon: React.ElementType; label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
      <span className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      <span className={cn("min-w-0 flex-1 whitespace-pre-line break-words", warn ? "text-amber-700" : "text-ink-950")}>{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3 text-center">
      <p className="font-display text-lg font-bold text-ink-950">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
    </div>
  );
}
