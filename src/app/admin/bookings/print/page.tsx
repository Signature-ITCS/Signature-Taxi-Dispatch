"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Printer, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { money, dateTime, cn } from "@/lib/format";
import { useBrand } from "@/components/BrandProvider";
import { fetchReportRows, filtersFromParams, fareOf, driverOf, splitOf, settlements, balanceLabel, type ReportRow } from "@/lib/bookingReport";

/**
 * A printable bookings report.
 *
 * There is no PDF library here on purpose: every browser can already turn a
 * page into a PDF, and its output is selectable, searchable text at whatever
 * paper size the user wants. So this renders a clean table, hides the admin
 * navigation with `print:` rules, and opens the print dialog — "Save as PDF"
 * does the rest, with nothing shipped to the browser to make it work.
 */

type Row = ReportRow;

export default function BookingsPrintPage() {
  return (
    <Suspense fallback={<Centered>Preparing report…</Centered>}>
      <Report />
    </Suspense>
  );
}

function Report() {
  const brand = useBrand();
  const params = useSearchParams();
  const supabase = createClient();
  const filters = filtersFromParams(new URLSearchParams(params.toString()));
  const { from, to, status, payment } = filters;
  const driverName = params.get("driver_name");

  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filterKey = params.toString();
  const load = useCallback(async () => {
    const { rows: data, error: err } = await fetchReportRows(supabase, filtersFromParams(new URLSearchParams(filterKey)));
    if (err) setError(err);
    setRows(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => {
    load();
  }, [load]);

  // Only open the print dialog once there is something on the page to print.
  useEffect(() => {
    if (rows && rows.length >= 0 && !error) {
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
  }, [rows, error]);

  if (!rows) return <Centered>Loading bookings…</Centered>;

  const completed = rows.filter((r) => r.status === "completed");
  const cashTotal = completed.filter((r) => r.payment_method === "cash").reduce((s, r) => s + fareOf(r), 0);
  const cardTotal = completed.filter((r) => r.payment_method === "card").reduce((s, r) => s + fareOf(r), 0);
  const takings = completed.reduce((s, r) => s + fareOf(r), 0);
  const outstanding = rows
    .filter((r) => r.payment_status !== "paid" && r.status !== "cancelled")
    .reduce((s, r) => s + fareOf(r), 0);

  const drivers = settlements(rows);

  const rangeLabel =
    from && to ? `${from} to ${to}` : from ? `from ${from}` : to ? `up to ${to}` : "All dates";

  return (
    <div className="bg-white px-5 py-6 text-ink-950 md:px-8 print:px-0 print:py-0">
      {/* Screen-only controls */}
      <div className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:text-ink-950"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-xl bg-ink-950 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-800"
        >
          <Printer className="h-4 w-4" /> Print / Save as PDF
        </button>
        <p className="text-xs text-gray-500">
          In the print dialog choose <b>Save as PDF</b> as the destination.
        </p>
      </div>

      {error && (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Could not load the bookings: {error}
        </p>
      )}

      {/* Report header */}
      <div className="mb-5 border-b border-gray-300 pb-4">
        <h1 className="font-display text-2xl font-bold">Bookings report</h1>
        <p className="mt-0.5 text-sm text-gray-600">
          {rangeLabel}
          {status !== "all" && ` · ${status.replace("_", " ")} only`}
          {payment !== "all" && ` · ${payment} jobs only`}
          {driverName && ` · driver: ${driverName}`}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">Generated {dateTime(new Date().toISOString())}</p>
      </div>

      {/* Totals */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Bookings" value={String(rows.length)} />
        <Tile label="Completed" value={String(completed.length)} />
        <Tile label="Completed takings" value={money(takings)} />
        <Tile label="Still owed" value={money(outstanding)} />
        <Tile label="Cash (completed)" value={money(cashTotal)} />
        <Tile label="Card (completed)" value={money(cardTotal)} />
      </div>

      {/* Driver settlement — staff only (this report is never shown to customers) */}
      {drivers.length > 0 && (
        <div className="mb-6 break-inside-avoid">
          <h2 className="mb-2 font-display text-base font-bold">Driver settlement (completed jobs)</h2>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b-2 border-gray-300 text-left">
                <Th>Driver</Th>
                <Th className="text-right">Jobs</Th>
                <Th className="text-right">Takings</Th>
                <Th className="text-right">Company commission</Th>
                <Th className="text-right">Driver earnings</Th>
                <Th className="text-right">Cash held by driver</Th>
                <Th className="text-right">Card / account held by company</Th>
                <Th className="text-right">Balance</Th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.driverId} className="border-b border-gray-200 align-top">
                  <Td className="font-semibold">
                    {d.name}
                    {d.rateMissing > 0 && (
                      <span className="block font-normal text-amber-700">
                        Commission not set on {d.rateMissing} job{d.rateMissing === 1 ? "" : "s"}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">{d.jobs}</Td>
                  <Td className="text-right">{money(d.takings)}</Td>
                  <Td className="text-right">{money(d.company)}</Td>
                  <Td className="text-right">{money(d.driver)}</Td>
                  <Td className="text-right">{money(d.cashHeld)}</Td>
                  <Td className="text-right">{money(d.companyHeld)}</Td>
                  <Td className={cn("text-right font-bold", d.balance > 0 ? "text-green-700" : d.balance < 0 ? "text-red-700" : "")}>
                    {balanceLabel(d.balance)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-[10px] text-gray-500">
            Cash jobs: the driver holds the fare and owes the company its commission. Card and account jobs: the company holds the fare and
            owes the driver their share. Balance = driver shares on card/account jobs − commission on cash jobs.
          </p>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-500">No bookings in this range.</p>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b-2 border-gray-300 text-left">
              <Th>Ref</Th>
              <Th>Date</Th>
              <Th>Customer</Th>
              <Th>Journey</Th>
              <Th>Driver</Th>
              <Th>Status</Th>
              <Th>Payment</Th>
              <Th className="text-right">Fare</Th>
              <Th className="text-right">Commission split</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-gray-200 align-top">
                <Td className="whitespace-nowrap font-mono">{r.booking_number}</Td>
                <Td className="whitespace-nowrap">{dateTime(r.scheduled_at ?? r.created_at)}</Td>
                <Td>
                  {r.customer_name}
                  <br />
                  <span className="text-gray-500">{r.customer_whatsapp}</span>
                </Td>
                <Td>
                  {r.pickup_address}
                  <br />
                  <span className="text-gray-500">→ {r.dropoff_address}</span>
                </Td>
                <Td>
                  {driverOf(r) || "—"}
                </Td>
                <Td className="whitespace-nowrap capitalize">{r.status.replace("_", " ")}</Td>
                <Td className="whitespace-nowrap capitalize">
                  {r.payment_method}
                  <br />
                  <span className={cn(r.payment_status === "paid" ? "text-green-700" : "text-gray-500")}>
                    {r.payment_status}
                  </span>
                </Td>
                <Td className="whitespace-nowrap text-right font-semibold">{money(fareOf(r))}</Td>
                <Td className="whitespace-nowrap text-right">
                  {(() => {
                    const sp = splitOf(r);
                    if (!sp) return <span className="text-gray-400">—</span>;
                    if (sp.rate == null) return <span className="text-amber-700">Rate not set</span>;
                    return (
                      <>
                        {sp.rate}% · company {money(sp.company)}
                        <br />
                        <span className="text-gray-600">driver {money(sp.driver)}</span>
                      </>
                    );
                  })()}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-6 text-[10px] text-gray-400">
        {brand.name} · {rows.length} booking{rows.length === 1 ? "" : "s"} · {rangeLabel}
      </p>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="font-display text-lg font-bold">{value}</p>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-1.5 py-2 font-semibold", className)}>{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-1.5 py-2", className)}>{children}</td>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-gray-500">
      <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      {children}
    </div>
  );
}
