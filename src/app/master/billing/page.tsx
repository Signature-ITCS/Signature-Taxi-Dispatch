"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Search, Mail, MessageCircle, Check, Undo2, X, Pencil } from "lucide-react";

type State = "upcoming" | "sent" | "overdue" | "paid" | "cancelled";
interface Row {
  id: string;
  number: string;
  plan_name: string | null;
  amount: number;
  currency: string;
  period_start: string;
  period_end: string;
  due_date: string;
  status: "upcoming" | "sent" | "paid" | "cancelled";
  state: State;
  sent_at: string | null;
  sent_via: string | null;
  payment_link: string | null;
  paid_at: string | null;
  paid_note: string | null;
  notes: string | null;
  company: { id: string; name: string; slug: string; status: string; owner_email: string | null; owner_phone: string | null } | null;
}
interface Totals {
  to_send: number;
  to_send_amount: number;
  waiting: number;
  waiting_amount: number;
  overdue: number;
  overdue_amount: number;
  paid_this_month: number;
  paid_this_month_amount: number;
}

const BADGE: Record<State, { label: string; tone: string }> = {
  upcoming: { label: "To send", tone: "bg-brand-50 text-brand-700" },
  sent: { label: "Link sent", tone: "bg-amber-50 text-amber-800" },
  overdue: { label: "Overdue", tone: "bg-red-50 text-red-700" },
  paid: { label: "Paid", tone: "bg-emerald-50 text-emerald-700" },
  cancelled: { label: "Cancelled", tone: "bg-gray-100 text-gray-500" },
};
const TABS = [
  ["send", "To send"],
  ["waiting", "Waiting for payment"],
  ["overdue", "Overdue"],
  ["paid", "Paid"],
  ["all", "All"],
] as const;
type Tab = (typeof TABS)[number][0];
const ERRORS: Record<string, string> = {
  invalid_link: "The payment link must start with https://",
  invalid_amount: "Enter a valid amount.",
  already_paid: "That invoice is already paid.",
  not_open: "That invoice is already paid or cancelled.",
};

const day = (d: string | null) =>
  d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "—";
const gbp = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
/** A UK-style number → digits for wa.me (07… → 447…). */
const waNumber = (p: string | null) => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.startsWith("0") ? `44${d.slice(1)}` : d;
};
const message = (r: Row, link: string) =>
  `Hello ${r.company?.name ?? ""},\n\nYour ${r.plan_name ?? ""} plan invoice ${r.number} for ${day(r.period_start)} – ${day(r.period_end)} is ${gbp(r.amount)}, due ${day(r.due_date)}.` +
  (link ? `\n\nPay securely here: ${link}` : "") +
  `\n\nThank you!`;

/** Who to send a payment link to, who has been sent one, and who has paid. Billed by hand — nothing here charges a card. */
export default function BillingPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("send");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/master/billing").then((r) => r.json()).catch(() => null);
    if (d?.ok) {
      setRows(d.invoices);
      setTotals(d.totals);
      setError(null);
    } else setError("Invoices couldn't be loaded. Try again in a minute.");
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? [])
      .filter((r) => {
        if (tab === "send" && r.status !== "upcoming") return false;
        if (tab === "waiting" && r.status !== "sent") return false;
        if (tab === "overdue" && r.state !== "overdue") return false;
        if (tab === "paid" && r.status !== "paid") return false;
        if (s && !`${r.company?.name ?? ""} ${r.number} ${r.company?.owner_email ?? ""}`.toLowerCase().includes(s)) return false;
        return true;
      })
      .sort((a, b) => (tab === "paid" || tab === "all" ? b.due_date.localeCompare(a.due_date) : a.due_date.localeCompare(b.due_date)));
  }, [rows, tab, q]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink-950">Billing</h1>
        <p className="text-sm text-gray-500">
          Each company&apos;s next invoice appears here a week before it&apos;s due. Send them a payment link by email or WhatsApp,
          press <strong>Mark sent</strong>, and <strong>Mark paid</strong> when the money arrives — so nobody is asked twice.
        </p>
      </div>

      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!rows && !error && <Loader2 className="h-6 w-6 animate-spin text-brand-500" />}

      {totals && (
        <div className="grid gap-3 sm:grid-cols-4">
          {(
            [
              ["To send", totals.to_send, totals.to_send_amount, "text-brand-700", "send"],
              ["Waiting for payment", totals.waiting, totals.waiting_amount, "text-amber-700", "waiting"],
              ["Overdue", totals.overdue, totals.overdue_amount, "text-red-700", "overdue"],
              ["Paid this month", totals.paid_this_month, totals.paid_this_month_amount, "text-emerald-700", "paid"],
            ] as const
          ).map(([label, n, amount, tone, t]) => (
            <button key={label} onClick={() => setTab(t)} className="rounded-2xl border border-gray-100 bg-white p-4 text-left hover:border-brand-200">
              <p className="text-xs uppercase text-gray-500">{label}</p>
              <p className={`mt-1 font-display text-2xl font-bold ${tone}`}>{gbp(amount)}</p>
              <p className="text-xs text-gray-500">{n} invoice{n === 1 ? "" : "s"}</p>
            </button>
          ))}
        </div>
      )}

      {rows && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {TABS.map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`rounded-full border px-3 py-1.5 text-sm ${tab === k ? "border-brand-500 bg-brand-50 font-semibold text-brand-700" : "border-gray-200 text-gray-600"}`}>
                {label}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm">
              <Search className="h-4 w-4 text-gray-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company, email or invoice" className="w-48 outline-none" />
            </label>
          </div>

          <div className="space-y-2">
            {shown.map((r) => (
              <InvoiceCard key={r.id} row={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onChanged={load} />
            ))}
            {shown.length === 0 && (
              <p className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-500">
                {tab === "send" ? "Nothing to send right now." : tab === "waiting" || tab === "overdue" ? "Nobody is waiting to pay." : "No invoices here yet."}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function InvoiceCard({ row: r, open, onToggle, onChanged }: { row: Row; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const [link, setLink] = useState(r.payment_link ?? "");
  const [amount, setAmount] = useState(String(r.amount));
  const [note, setNote] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const act = async (action: string, body: Record<string, unknown> = {}, okText = "Saved.") => {
    setBusy(action);
    setMsg(null);
    const d = await fetch("/api/master/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action, ...body }) })
      .then((x) => x.json())
      .catch(() => null);
    setBusy(null);
    if (d?.ok) {
      setMsg({ ok: true, text: okText });
      onChanged();
    } else setMsg({ ok: false, text: ERRORS[d?.error] ?? "That didn't work." });
  };

  const c = r.company;
  const text = message(r, link.trim());
  const mailto = c?.owner_email ? `mailto:${c.owner_email}?subject=${encodeURIComponent(`Invoice ${r.number} — ${gbp(r.amount)}`)}&body=${encodeURIComponent(text)}` : null;
  const wa = c?.owner_phone ? `https://wa.me/${waNumber(c.owner_phone)}?text=${encodeURIComponent(text)}` : null;
  const unpaid = r.status === "upcoming" || r.status === "sent";

  return (
    <div className="rounded-2xl border border-gray-100 bg-white">
      <button onClick={onToggle} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-sm">
        <span className="min-w-[10rem] flex-1">
          <span className="font-semibold text-ink-950">{c?.name ?? "Deleted company"}</span>
          <span className="block text-xs text-gray-500">{r.number} · {r.plan_name} · {day(r.period_start)} – {day(r.period_end)}</span>
        </span>
        <span className="font-semibold text-ink-950">{gbp(r.amount)}</span>
        <span className="w-28 text-gray-600">{r.status === "paid" ? `Paid ${day(r.paid_at)}` : `Due ${day(r.due_date)}`}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE[r.state].tone}`}>{BADGE[r.state].label}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-gray-50 px-4 py-4 text-sm">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-gray-600">
            {c && <Link href={`/master/companies?open=${c.id}`} className="text-brand-600">Open company</Link>}
            <span>Email: {c?.owner_email ?? "—"}</span>
            <span>WhatsApp: {c?.owner_phone ?? "— (add it on the company)"}</span>
            {r.sent_at && <span>Sent {day(r.sent_at)}{r.sent_via ? ` by ${r.sent_via}` : ""}</span>}
            {r.paid_note && <span>Note: {r.paid_note}</span>}
          </div>

          {msg && <p className={`rounded-xl p-2.5 ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}

          {unpaid && (
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto]">
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Payment link (shown to the company too)</span>
                <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://buy.stripe.com/… or any pay link"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Amount (£)</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2" />
              </label>
              <button onClick={() => act("edit", { payment_link: link.trim(), amount }, "Saved.")} disabled={!!busy}
                className="flex items-center justify-center gap-1.5 self-end rounded-xl border border-gray-200 px-3 py-2 font-semibold text-ink-950 disabled:opacity-60">
                {busy === "edit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />} Save
              </button>
            </div>
          )}

          {r.status === "upcoming" && (
            <div className="flex flex-wrap items-center gap-2">
              {mailto && (
                <a href={mailto} className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 font-semibold text-ink-950">
                  <Mail className="h-4 w-4" /> Write email
                </a>
              )}
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 font-semibold text-ink-950">
                  <MessageCircle className="h-4 w-4" /> Write WhatsApp
                </a>
              )}
              <span className="text-xs text-gray-400">then</span>
              <button onClick={() => act("sent", { via: "email", payment_link: link.trim() || undefined }, "Marked as sent by email.")} disabled={!!busy}
                className="flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2 font-semibold text-white disabled:opacity-60">
                {busy === "sent" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Mark sent (email)
              </button>
              <button onClick={() => act("sent", { via: "whatsapp", payment_link: link.trim() || undefined }, "Marked as sent by WhatsApp.")} disabled={!!busy}
                className="flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2 font-semibold text-white disabled:opacity-60">
                <Check className="h-4 w-4" /> Mark sent (WhatsApp)
              </button>
            </div>
          )}

          {unpaid && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Paid on</span>
                <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="mt-1 block rounded-xl border border-gray-200 px-3 py-2" />
              </label>
              <label className="block flex-1">
                <span className="text-xs font-medium text-gray-600">Note (e.g. payment reference)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2" />
              </label>
              <button onClick={() => act("paid", { paid_at: paidOn, note }, "Marked as paid — the company is paid up until the end of this period.")} disabled={!!busy}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 font-semibold text-white disabled:opacity-60">
                {busy === "paid" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Mark paid
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-gray-50 pt-3">
            {r.status === "sent" && (
              <button onClick={() => act("unsent", {}, "Back to “To send”.")} disabled={!!busy} className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700">
                <Undo2 className="h-3.5 w-3.5" /> Not sent after all
              </button>
            )}
            {r.status === "paid" && (
              <button onClick={() => act("unpaid", {}, "No longer marked paid.")} disabled={!!busy} className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700">
                <Undo2 className="h-3.5 w-3.5" /> Undo paid
              </button>
            )}
            {unpaid && (
              <button
                onClick={() => confirm(`Cancel invoice ${r.number}? A fresh one for the same period is made at the plan's current price. To give a month free, mark it paid with a note instead.`) && act("cancel", {}, "Cancelled.")}
                disabled={!!busy}
                className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700"
              >
                <X className="h-3.5 w-3.5" /> Cancel invoice
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
