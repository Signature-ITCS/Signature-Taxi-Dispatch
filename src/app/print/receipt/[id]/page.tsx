"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2, Printer, Download, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { money, dateTime, dateTimeFull } from "@/lib/format";
import { useBrand } from "@/components/BrandProvider";
import { Logo } from "@/components/Brand";
import type { Booking, FareBreakdown } from "@/lib/types";

/**
 * A customer receipt for one journey.
 *
 * Like the bookings report there is no PDF library: the browser's print dialog
 * prints it, and "Save as PDF" downloads it (the page title becomes the file
 * name, e.g. Receipt-TX261015-1027-0ED6A0.pdf).
 *
 *   /print/receipt/<booking id>?print=1  → opens the print dialog
 *   /print/receipt/<booking id>?pdf=1    → same, with a "choose Save as PDF" hint
 */

interface Row extends Booking {
  category?: { name: string } | null;
  driver?: { full_name: string } | null;
}
interface Vehicle {
  make: string | null;
  model: string | null;
  color: string | null;
  license_plate: string | null;
}
type Fare = FareBreakdown & { custom?: boolean; custom_trip_total?: number; note?: string };

export default function ReceiptPage() {
  return (
    <Suspense fallback={<Centered>Preparing receipt…</Centered>}>
      <Receipt />
    </Suspense>
  );
}

function Receipt() {
  // The company whose receipt this is (from the print layout).
  const BRAND = useBrand();
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const wantsPdf = params.get("pdf") === "1";
  const autoPrint = wantsPdf || params.get("print") === "1";
  const [supabase] = useState(() => createClient());
  const [row, setRow] = useState<Row | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase
        .from("bookings")
        .select("*, category:vehicle_categories!bookings_vehicle_category_id_fkey(name), driver:drivers(full_name)")
        .eq("id", id)
        .maybeSingle();
      if (err || !data) {
        setError(err?.message ?? "Booking not found.");
        return;
      }
      const b = data as Row;
      if (b.driver_id) {
        const { data: v } = await supabase
          .from("vehicles")
          .select("make, model, color, license_plate")
          .eq("driver_id", b.driver_id)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();
        setVehicle((v as Vehicle) ?? null);
      }
      setRow(b);
      // The saved PDF is named after the page title.
      document.title = `Receipt-${b.booking_number}`;
    })();
  }, [supabase, id]);

  useEffect(() => {
    if (!row || !autoPrint) return;
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, [row, autoPrint]);

  if (error) return <Centered>{error}</Centered>;
  if (!row) return <Centered>Loading receipt…</Centered>;

  const fare = (row.fare_breakdown ?? {}) as Fare;
  const total = Number(row.final_fare ?? row.estimated_fare ?? 0);
  const lines = fareLines(fare, Number(row.distance_km) || 0);
  const linesSum = lines.reduce((s, l) => s + l.amount, 0);
  const diff = Math.round((total - linesSum) * 100) / 100;
  if (lines.length && Math.abs(diff) >= 0.01) lines.push({ label: Math.abs(diff) < 1 ? "Rounding" : "Adjustment", amount: diff });
  if (!lines.length) lines.push({ label: "Journey fare", amount: total });

  const paid = row.payment_status === "paid";
  const refunded = row.payment_status === "refunded" || row.job_status === "refunded";
  const payLabel = refunded
    ? "Refunded"
    : paid
      ? row.payment_method === "card"
        ? "Paid by card"
        : "Paid by cash"
      : "Not yet paid";
  const journeyAt = row.scheduled_at ?? row.created_at;
  const driverName = row.driver?.full_name ?? row.external_driver_name ?? null;
  const car = vehicle
    ? [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(" ") + (vehicle.license_plate ? ` · ${vehicle.license_plate}` : "")
    : [row.external_vehicle_color, row.external_vehicle_make, row.external_vehicle_model].filter(Boolean).join(" ") +
      (row.external_vehicle_plate ? ` · ${row.external_vehicle_plate}` : "");
  const vias = (row.via_points ?? []).map((v) => v.address).filter(Boolean);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 print:max-w-none print:p-0">
      {/* Toolbar — not printed */}
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-xl bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white"
        >
          <Printer className="h-4 w-4" /> Print
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          <Download className="h-4 w-4" /> Download PDF
        </button>
        <button
          onClick={() => window.close()}
          className="ml-auto flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600"
        >
          <X className="h-4 w-4" /> Close
        </button>
        <p className="w-full text-xs text-gray-500">
          {wantsPdf ? <b>To download: choose “Save as PDF” as the printer, then Save.</b> : "Download PDF: choose “Save as PDF” as the printer."}
        </p>
      </div>

      {/* The receipt */}
      <div className="rounded-2xl bg-white p-8 shadow-sm print:rounded-none print:p-0 print:shadow-none">
        <div className="flex items-start justify-between gap-6 border-b border-gray-200 pb-5">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <Logo height={48} className="h-12 w-auto" />
            <div className="mt-3 text-xs leading-relaxed text-gray-500">
              <p className="font-semibold text-ink-950">{BRAND.legalName || BRAND.name}</p>
              {BRAND.contact?.address && <p>{BRAND.contact.address}</p>}
              <p>
                {[BRAND.contact?.phone, BRAND.contact?.email, BRAND.contact?.website].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-display text-2xl font-bold uppercase tracking-wide text-ink-950">Receipt</p>
            <p className="mt-1 font-mono text-sm text-gray-600">{row.booking_number}</p>
            <p className="mt-1 text-xs text-gray-500">Issued {dateTimeFull(new Date().toISOString())}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 border-b border-gray-200 py-5 text-sm">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Customer</p>
            <p className="font-medium text-ink-950">{row.customer_name}</p>
            {row.customer_whatsapp && <p className="text-gray-600">{row.customer_whatsapp}</p>}
            {row.customer_email && <p className="text-gray-600">{row.customer_email}</p>}
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Journey</p>
            <p className="text-gray-700">
              <span className="text-gray-400">Date:</span> {dateTimeFull(journeyAt)}
            </p>
            {row.completed_at && (
              <p className="text-gray-700">
                <span className="text-gray-400">Completed:</span> {dateTime(row.completed_at)}
              </p>
            )}
            {row.category?.name && (
              <p className="text-gray-700">
                <span className="text-gray-400">Vehicle:</span> {row.category.name}
                {row.passengers ? ` · ${row.passengers} passenger${row.passengers === 1 ? "" : "s"}` : ""}
              </p>
            )}
            {driverName && (
              <p className="text-gray-700">
                <span className="text-gray-400">Driver:</span> {driverName}
                {car.trim() ? ` · ${car.trim()}` : ""}
              </p>
            )}
          </div>
        </div>

        <div className="border-b border-gray-200 py-5 text-sm">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Route</p>
          <ol className="space-y-1.5">
            <li>
              <span className="mr-2 inline-block w-14 text-xs font-semibold text-green-700">From</span>
              {row.pickup_address}
            </li>
            {vias.map((v, i) => (
              <li key={i}>
                <span className="mr-2 inline-block w-14 text-xs font-semibold text-gray-400">Stop {i + 1}</span>
                {v}
              </li>
            ))}
            <li>
              <span className="mr-2 inline-block w-14 text-xs font-semibold text-brand-700">To</span>
              {row.dropoff_address}
            </li>
          </ol>
          {Number(row.distance_km) > 0 && <p className="mt-2 text-xs text-gray-500">Distance: {Number(row.distance_km).toFixed(1)} miles</p>}
        </div>

        <table className="mt-5 w-full text-sm">
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1.5 text-gray-700">{l.label}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-700">{money(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-ink-950">
              <td className="pt-3 font-display text-base font-bold text-ink-950">Total</td>
              <td className="pt-3 text-right font-display text-xl font-bold tabular-nums text-ink-950">{money(total)}</td>
            </tr>
            <tr>
              <td className="pt-1 text-sm text-gray-500">Payment</td>
              <td className={`pt-1 text-right text-sm font-semibold ${paid && !refunded ? "text-green-700" : "text-amber-700"}`}>{payLabel}</td>
            </tr>
          </tbody>
        </table>

        <p className="mt-8 border-t border-gray-200 pt-4 text-center text-xs text-gray-500">
          Thank you for travelling with {BRAND.name}.
        </p>
      </div>
    </div>
  );
}

/** The fare lines a receipt shows, from the breakdown saved when the trip was booked. */
function fareLines(f: Fare, miles: number): { label: string; amount: number }[] {
  if (f.custom) return [{ label: "Agreed fare", amount: Number(f.total) || 0 }];
  const out: { label: string; amount: number }[] = [];
  if (f.fixed_route) {
    out.push({ label: `Fixed price: ${f.fixed_route}`, amount: Number(f.fixed_price) || 0 });
    if (Number(f.detour_cost) > 0) out.push({ label: `Extra miles for stops (${Number(f.detour_miles).toFixed(1)} mi)`, amount: Number(f.detour_cost) });
  } else {
    if (Number(f.base_fare) > 0) out.push({ label: "Base fare", amount: Number(f.base_fare) });
    if (Number(f.distance_cost) > 0) out.push({ label: miles > 0 ? `Distance (${miles.toFixed(1)} mi)` : "Distance", amount: Number(f.distance_cost) });
  }
  for (const e of f.extras ?? []) if (Number(e.amount)) out.push({ label: e.name, amount: Number(e.amount) });
  return out;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-gray-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {children}
    </div>
  );
}
