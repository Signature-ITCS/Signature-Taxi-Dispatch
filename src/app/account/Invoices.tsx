"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2, ExternalLink } from "lucide-react";

interface Invoice {
  id: string;
  number: string;
  plan_name: string | null;
  amount: number;
  currency: string;
  period_start: string;
  period_end: string;
  due_date: string;
  state: "upcoming" | "sent" | "overdue" | "paid" | "cancelled";
  sent_at: string | null;
  paid_at: string | null;
  payment_link: string | null;
}

const BADGE: Record<Invoice["state"], { label: string; tone: string }> = {
  upcoming: { label: "Upcoming", tone: "bg-gray-100 text-gray-600" },
  sent: { label: "Payment link sent", tone: "bg-amber-50 text-amber-800" },
  overdue: { label: "Overdue", tone: "bg-red-50 text-red-700" },
  paid: { label: "Paid", tone: "bg-emerald-50 text-emerald-700" },
  cancelled: { label: "Cancelled", tone: "bg-gray-100 text-gray-500" },
};

const day = (d: string | null) =>
  d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "—";
const money = (n: number, cur: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency: cur.toUpperCase() }).format(n);

/** The company's subscription invoices. We send each payment link by email or WhatsApp. */
export default function Invoices({ supportEmail }: { supportEmail: string }) {
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/account/invoices")
      .then((r) => r.json())
      .then((d) => (d?.ok ? setRows(d.invoices) : setFailed(true)))
      .catch(() => setFailed(true));
  }, []);

  const unpaid = (rows ?? []).filter((r) => r.state === "sent" || r.state === "overdue" || r.state === "upcoming");

  return (
    <section className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink-950">
        <FileText className="h-5 w-5 text-brand-600" /> Invoices
      </h2>
      <p className="mt-1 text-sm text-gray-600">
        Each month we send you a payment link for your plan by email or WhatsApp. Pay it there — we never save your card or
        charge it automatically.{supportEmail ? <> Questions about an invoice: <a className="text-brand-600" href={`mailto:${supportEmail}`}>{supportEmail}</a>.</> : null}
      </p>

      {unpaid.some((r) => r.state === "overdue") && (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          An invoice is overdue: <strong>{money(unpaid.filter((r) => r.state === "overdue").reduce((n, r) => n + r.amount, 0), unpaid[0].currency)}</strong>.
          Please pay it with the link we sent you, so your account stays switched on.
        </p>
      )}

      {!rows && !failed && <Loader2 className="mt-4 h-5 w-5 animate-spin text-brand-500" />}
      {failed && <p className="mt-4 text-sm text-gray-500">Invoices couldn&apos;t be loaded just now. Please try again later.</p>}
      {rows && rows.length === 0 && (
        <p className="mt-4 text-sm text-gray-500">No invoices yet — the first one comes a few days before your billing date.</p>
      )}

      {rows && rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="py-2 pr-3">Invoice</th>
                <th className="py-2 pr-3">For</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Due / paid</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-50">
                  <td className="py-2.5 pr-3 font-mono text-xs text-gray-600">{r.number}</td>
                  <td className="py-2.5 pr-3 text-gray-600">
                    {r.plan_name ? `${r.plan_name}, ` : ""}
                    {day(r.period_start)} – {day(r.period_end)}
                  </td>
                  <td className="py-2.5 pr-3 font-medium text-ink-950">{money(r.amount, r.currency)}</td>
                  <td className="py-2.5 pr-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE[r.state].tone}`}>{BADGE[r.state].label}</span>
                  </td>
                  <td className="py-2.5 pr-3 text-gray-600">{r.state === "paid" ? `Paid ${day(r.paid_at)}` : `Due ${day(r.due_date)}`}</td>
                  <td className="py-2.5 text-right">
                    {r.payment_link && (
                      <a href={r.payment_link} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white">
                        Pay now <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
