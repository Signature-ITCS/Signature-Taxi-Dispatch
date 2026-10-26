"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2, ExternalLink, Download } from "lucide-react";

interface Invoice {
  id: string;
  number: string | null;
  created: string;
  due_date: string | null;
  paid_at: string | null;
  period_start: string | null;
  period_end: string | null;
  amount: number;
  amount_remaining: number;
  currency: string;
  status: "paid" | "due" | "overdue" | "void" | "uncollectible";
  pay_url: string | null;
  pdf_url: string | null;
}

const BADGE: Record<Invoice["status"], { label: string; tone: string }> = {
  paid: { label: "Paid", tone: "bg-emerald-50 text-emerald-700" },
  due: { label: "Due", tone: "bg-amber-50 text-amber-800" },
  overdue: { label: "Overdue", tone: "bg-red-50 text-red-700" },
  void: { label: "Cancelled", tone: "bg-gray-100 text-gray-500" },
  uncollectible: { label: "Not collected", tone: "bg-gray-100 text-gray-500" },
};

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "—";
const money = (n: number, cur: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency: cur.toUpperCase() }).format(n);

/** The company's subscription invoices: paid, due and overdue, each with Pay and PDF. */
export default function Invoices() {
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/account/invoices")
      .then((r) => r.json())
      .then((d) => (d?.ok ? setRows(d.invoices) : setFailed(true)))
      .catch(() => setFailed(true));
  }, []);

  const unpaid = (rows ?? []).filter((r) => r.status === "due" || r.status === "overdue");

  return (
    <section className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink-950">
        <FileText className="h-5 w-5 text-brand-600" /> Invoices
      </h2>
      <p className="mt-1 text-sm text-gray-600">
        Each month you get an invoice by email. Pay it here or from the email — you type your card in on Stripe&apos;s secure
        page each time; it&apos;s never saved or charged automatically.
      </p>

      {unpaid.length > 0 && (
        <p className={`mt-3 rounded-xl p-3 text-sm ${unpaid.some((r) => r.status === "overdue") ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800"}`}>
          {unpaid.length === 1 ? "1 invoice" : `${unpaid.length} invoices`} to pay:{" "}
          <strong>{money(unpaid.reduce((n, r) => n + r.amount_remaining, 0), unpaid[0].currency)}</strong>
          {unpaid.some((r) => r.status === "overdue") ? " — overdue." : `, due ${day(unpaid[unpaid.length - 1].due_date)}.`}
        </p>
      )}

      {!rows && !failed && <Loader2 className="mt-4 h-5 w-5 animate-spin text-brand-500" />}
      {failed && <p className="mt-4 text-sm text-gray-500">Invoices couldn&apos;t be loaded just now. Try again later, or use Manage billing.</p>}
      {rows && rows.length === 0 && <p className="mt-4 text-sm text-gray-500">No invoices yet{" "}— the first one comes at the end of your free trial or first month.</p>}

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
                  <td className="py-2.5 pr-3 font-mono text-xs text-gray-600">{r.number ?? "—"}</td>
                  <td className="py-2.5 pr-3 text-gray-600">{r.period_start ? `${day(r.period_start)} – ${day(r.period_end)}` : day(r.created)}</td>
                  <td className="py-2.5 pr-3 font-medium text-ink-950">{money(r.amount, r.currency)}</td>
                  <td className="py-2.5 pr-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE[r.status].tone}`}>{BADGE[r.status].label}</span>
                  </td>
                  <td className="py-2.5 pr-3 text-gray-600">{r.status === "paid" ? `Paid ${day(r.paid_at)}` : r.due_date ? `Due ${day(r.due_date)}` : "—"}</td>
                  <td className="py-2.5 text-right">
                    <div className="flex justify-end gap-2">
                      {r.pay_url && (
                        <a href={r.pay_url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white">
                          Pay now <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {r.pdf_url && (
                        <a href={r.pdf_url} target="_blank" rel="noopener noreferrer" aria-label="Download PDF"
                          className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700">
                          <Download className="h-3 w-3" /> PDF
                        </a>
                      )}
                    </div>
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
