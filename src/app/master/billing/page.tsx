"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, ExternalLink, Search } from "lucide-react";

interface Row {
  id: string;
  number: string | null;
  customer: string | null;
  created: string;
  due_date: string | null;
  paid_at: string | null;
  amount: number;
  amount_remaining: number;
  currency: string;
  status: "paid" | "due" | "overdue" | "void" | "uncollectible";
  pdf_url: string | null;
  company: { id: string; name: string; slug: string; status: string } | null;
}
interface Totals {
  collected_this_month: number;
  outstanding: number;
  unpaid_count: number;
  overdue_amount: number;
  overdue_count: number;
  overdue_companies: number;
}

const BADGE: Record<Row["status"], { label: string; tone: string }> = {
  paid: { label: "Paid", tone: "bg-emerald-50 text-emerald-700" },
  due: { label: "Due", tone: "bg-amber-50 text-amber-800" },
  overdue: { label: "Overdue", tone: "bg-red-50 text-red-700" },
  void: { label: "Cancelled", tone: "bg-gray-100 text-gray-500" },
  uncollectible: { label: "Not collected", tone: "bg-gray-100 text-gray-500" },
};
const FILTERS = [
  ["all", "All"],
  ["unpaid", "Unpaid"],
  ["overdue", "Overdue"],
  ["paid", "Paid"],
] as const;
type Filter = (typeof FILTERS)[number][0];

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "—";
const gbp = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

/** Who has paid and who hasn't: every company's subscription invoices, live from Stripe. */
export default function BillingPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("unpaid");
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/master/billing")
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) {
          setRows(d.invoices);
          setTotals(d.totals);
        } else setError(d?.error === "stripe_not_configured" ? "Add your Stripe secret key in Platform settings first." : "Stripe couldn't be reached. Try again in a minute.");
      })
      .catch(() => setError("Stripe couldn't be reached. Try again in a minute."));
  }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (filter === "unpaid" && r.status !== "due" && r.status !== "overdue") return false;
      if (filter === "overdue" && r.status !== "overdue") return false;
      if (filter === "paid" && r.status !== "paid") return false;
      if (s && !`${r.company?.name ?? ""} ${r.number ?? ""}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [rows, filter, q]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink-950">Billing</h1>
        <p className="text-sm text-gray-500">Companies&apos; subscription invoices from the last 13 months, live from your Stripe. Companies pay each invoice themselves — no card is saved or charged automatically.</p>
      </div>

      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!rows && !error && <Loader2 className="h-6 w-6 animate-spin text-brand-500" />}

      {totals && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-gray-100 bg-white p-4">
            <p className="text-xs uppercase text-gray-500">Collected this month</p>
            <p className="mt-1 font-display text-2xl font-bold text-emerald-700">{gbp(totals.collected_this_month)}</p>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white p-4">
            <p className="text-xs uppercase text-gray-500">Waiting to be paid</p>
            <p className="mt-1 font-display text-2xl font-bold text-amber-700">{gbp(totals.outstanding)}</p>
            <p className="text-xs text-gray-500">{totals.unpaid_count} invoice{totals.unpaid_count === 1 ? "" : "s"}</p>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white p-4">
            <p className="text-xs uppercase text-gray-500">Overdue</p>
            <p className="mt-1 font-display text-2xl font-bold text-red-700">{gbp(totals.overdue_amount)}</p>
            <p className="text-xs text-gray-500">
              {totals.overdue_count} invoice{totals.overdue_count === 1 ? "" : "s"} · {totals.overdue_companies} compan{totals.overdue_companies === 1 ? "y" : "ies"}
            </p>
          </div>
        </div>
      )}

      {rows && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`rounded-full border px-3 py-1.5 text-sm ${filter === k ? "border-brand-500 bg-brand-50 font-semibold text-brand-700" : "border-gray-200 text-gray-600"}`}>
                {label}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm">
              <Search className="h-4 w-4 text-gray-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company or invoice number" className="w-48 outline-none" />
            </label>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Sent</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Due / paid</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-gray-50">
                    <td className="px-4 py-2.5">
                      {r.company ? (
                        <Link href={`/master/companies?open=${r.company.id}`} className="font-medium text-ink-950 hover:text-brand-600">{r.company.name}</Link>
                      ) : (
                        <span className="text-gray-400">Not linked ({r.customer ?? "—"})</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{r.number ?? "—"}</td>
                    <td className="px-4 py-2.5 text-gray-600">{day(r.created)}</td>
                    <td className="px-4 py-2.5 font-medium text-ink-950">{gbp(r.amount)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE[r.status].tone}`}>{BADGE[r.status].label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{r.status === "paid" ? `Paid ${day(r.paid_at)}` : r.due_date ? `Due ${day(r.due_date)}` : "—"}</td>
                    <td className="px-4 py-2.5 text-right">
                      <a href={`https://dashboard.stripe.com/invoices/${r.id}`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
                        Stripe <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      {filter === "unpaid" || filter === "overdue" ? "Nothing waiting — everyone has paid." : "No invoices yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
