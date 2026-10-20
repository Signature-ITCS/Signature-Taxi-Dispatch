import type { createClient } from "@/lib/supabase/client";
import type { BookingStatus } from "@/lib/types";

/**
 * One definition of "which bookings are in this report", shared by the
 * printable report (/admin/bookings/print) and the CSV download, so the PDF
 * and the spreadsheet can never disagree.
 */
export interface ReportFilters {
  /** yyyy-mm-dd, inclusive, UK local days. */
  from: string;
  to: string;
  status: BookingStatus | "all";
  payment: "all" | "cash" | "card";
  /** A driver's id, or null for every driver. */
  driver: string | null;
}

export interface ReportRow {
  id: string;
  booking_number: string;
  customer_name: string;
  customer_whatsapp: string;
  customer_email: string | null;
  pickup_address: string;
  dropoff_address: string;
  status: BookingStatus;
  payment_method: string;
  payment_status: string;
  estimated_fare: number | null;
  final_fare: number | null;
  distance_km: number | null;
  external_provider: string | null;
  external_driver_name: string | null;
  scheduled_at: string | null;
  created_at: string;
  completed_at: string | null;
  driver?: { full_name: string } | null;
}

const FIELDS =
  "id, booking_number, customer_name, customer_whatsapp, customer_email, pickup_address, dropoff_address, status, payment_method, payment_status, estimated_fare, final_fare, distance_km, external_provider, external_driver_name, scheduled_at, created_at, completed_at, driver:drivers(full_name)";

export function filtersToParams(f: ReportFilters): URLSearchParams {
  const p = new URLSearchParams({ from: f.from, to: f.to, status: f.status, payment: f.payment });
  if (f.driver) p.set("driver", f.driver);
  return p;
}

export function filtersFromParams(p: URLSearchParams): ReportFilters {
  const payment = p.get("payment");
  return {
    from: p.get("from") ?? "",
    to: p.get("to") ?? "",
    status: (p.get("status") as BookingStatus | "all") ?? "all",
    payment: payment === "cash" || payment === "card" ? payment : "all",
    driver: p.get("driver") || null,
  };
}

export async function fetchReportRows(
  supabase: ReturnType<typeof createClient>,
  f: ReportFilters
): Promise<{ rows: ReportRow[]; error: string | null }> {
  let q = supabase.from("bookings").select(FIELDS).order("created_at", { ascending: false }).limit(5000);
  if (f.from) q = q.gte("created_at", new Date(`${f.from}T00:00:00`).toISOString());
  if (f.to) q = q.lte("created_at", new Date(`${f.to}T23:59:59`).toISOString());
  if (f.status !== "all") q = q.eq("status", f.status);
  if (f.payment !== "all") q = q.eq("payment_method", f.payment);
  if (f.driver) q = q.eq("driver_id", f.driver);
  const { data, error } = await q;
  return { rows: (data as unknown as ReportRow[]) ?? [], error: error?.message ?? null };
}

export const fareOf = (r: ReportRow) => Number(r.final_fare ?? r.estimated_fare ?? 0);

export const driverOf = (r: ReportRow) =>
  r.driver?.full_name ?? r.external_driver_name ?? (r.external_provider ? `Outside job (${r.external_provider})` : "");

const ukDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        timeZone: "Europe/London",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

/** Excel-friendly CSV (UTF-8 with BOM, so £ and names display correctly). */
export function toCsv(rows: ReportRow[]): string {
  const head = [
    "Reference",
    "Date",
    "Completed",
    "Customer",
    "Phone",
    "Email",
    "Pick-up",
    "Drop-off",
    "Miles",
    "Driver",
    "Status",
    "Payment",
    "Payment status",
    "Fare (GBP)",
  ];
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    // Quote everything; neutralise spreadsheet formulas typed into a field.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = rows.map((r) =>
    [
      r.booking_number,
      ukDateTime(r.scheduled_at ?? r.created_at),
      ukDateTime(r.completed_at),
      r.customer_name,
      r.customer_whatsapp,
      r.customer_email ?? "",
      r.pickup_address,
      r.dropoff_address,
      r.distance_km ?? "",
      driverOf(r),
      r.status.replace("_", " "),
      r.payment_method,
      r.payment_status,
      fareOf(r).toFixed(2),
    ]
      .map(cell)
      .join(",")
  );
  return "﻿" + [head.map(cell).join(","), ...lines].join("\r\n");
}
