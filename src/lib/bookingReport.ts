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
  driver_id?: string | null;
  /** Company commission % that applied (copied on completion); see db/2026-11-03_driver_commission.sql. */
  commission_percent?: number | null;
  driver?: { full_name: string; commission_percent?: number | null } | null;
}

const BASE_FIELDS =
  "id, booking_number, customer_name, customer_whatsapp, customer_email, pickup_address, dropoff_address, status, payment_method, payment_status, estimated_fare, final_fare, distance_km, external_provider, external_driver_name, scheduled_at, created_at, completed_at, driver_id";
const FIELDS = `${BASE_FIELDS}, commission_percent, driver:drivers(full_name, commission_percent)`;
// Until the commission migration is run the columns don't exist: fall back so reports keep working.
const LEGACY_FIELDS = `${BASE_FIELDS}, driver:drivers(full_name)`;

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
  const run = (fields: string) => {
    let q = supabase.from("bookings").select(fields).order("created_at", { ascending: false }).limit(5000);
    if (f.from) q = q.gte("created_at", new Date(`${f.from}T00:00:00`).toISOString());
    if (f.to) q = q.lte("created_at", new Date(`${f.to}T23:59:59`).toISOString());
    if (f.status !== "all") q = q.eq("status", f.status);
    if (f.payment !== "all") q = q.eq("payment_method", f.payment);
    if (f.driver) q = q.eq("driver_id", f.driver);
    return q;
  };
  let { data, error } = await run(FIELDS);
  if (error && /commission_percent/.test(error.message)) ({ data, error } = await run(LEGACY_FIELDS));
  return { rows: (data as unknown as ReportRow[]) ?? [], error: error?.message ?? null };
}

export const fareOf = (r: ReportRow) => Number(r.final_fare ?? r.estimated_fare ?? 0);

export const driverOf = (r: ReportRow) =>
  r.driver?.full_name ?? r.external_driver_name ?? (r.external_provider ? `Outside job (${r.external_provider})` : "");

/* ───────────────────── driver commission (staff only) ─────────────────────
 * The company keeps commission_percent of each fare; the driver earns the rest.
 * Who is holding the money decides who owes whom:
 *   cash          → the driver collected the fare and owes the company its commission
 *   card/account  → the company has the fare and owes the driver their share
 * Only completed jobs done by one of our drivers count.
 */
export interface JobSplit {
  rate: number | null; // company %; null = not set for this driver
  fare: number;
  company: number;
  driver: number;
  heldBy: "driver" | "company";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function splitOf(r: ReportRow): JobSplit | null {
  if (r.status !== "completed" || !r.driver_id) return null;
  const rate = r.commission_percent ?? r.driver?.commission_percent ?? null;
  const fare = fareOf(r);
  const company = rate == null ? 0 : r2((fare * Number(rate)) / 100);
  return { rate: rate == null ? null : Number(rate), fare, company, driver: r2(fare - company), heldBy: r.payment_method === "cash" ? "driver" : "company" };
}

export interface DriverSettlement {
  driverId: string;
  name: string;
  jobs: number;
  takings: number;
  company: number; // total commission
  driver: number; // total driver earnings
  cashHeld: number; // fares the driver collected in cash
  companyHeld: number; // card / account fares the company holds
  /** Positive: company pays the driver. Negative: the driver pays the company. */
  balance: number;
  rateMissing: number; // completed jobs with no commission rate set
}

export function settlements(rows: ReportRow[]): DriverSettlement[] {
  const by = new Map<string, DriverSettlement>();
  for (const r of rows) {
    const s = splitOf(r);
    if (!s) continue;
    const id = r.driver_id!;
    const d =
      by.get(id) ??
      ({ driverId: id, name: r.driver?.full_name ?? "Driver", jobs: 0, takings: 0, company: 0, driver: 0, cashHeld: 0, companyHeld: 0, balance: 0, rateMissing: 0 } as DriverSettlement);
    d.jobs += 1;
    d.takings = r2(d.takings + s.fare);
    d.company = r2(d.company + s.company);
    d.driver = r2(d.driver + s.driver);
    if (s.heldBy === "driver") {
      d.cashHeld = r2(d.cashHeld + s.fare);
      d.balance = r2(d.balance - s.company);
    } else {
      d.companyHeld = r2(d.companyHeld + s.fare);
      d.balance = r2(d.balance + s.driver);
    }
    if (s.rate == null) d.rateMissing += 1;
    by.set(id, d);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const balanceLabel = (b: number) =>
  b > 0 ? `Company pays driver £${b.toFixed(2)}` : b < 0 ? `Driver pays company £${(-b).toFixed(2)}` : "Settled (nothing owed)";

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
    "Commission %",
    "Company share (GBP)",
    "Driver share (GBP)",
    "Money held by",
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
      ...(() => {
        const s = splitOf(r);
        if (!s) return ["", "", "", ""];
        return [s.rate == null ? "not set" : s.rate, s.company.toFixed(2), s.driver.toFixed(2), s.heldBy === "driver" ? "Driver (cash)" : "Company"];
      })(),
    ]
      .map(cell)
      .join(",")
  );
  const set = settlements(rows);
  const summary = set.length
    ? [
        "",
        cell("DRIVER SETTLEMENT (completed jobs)"),
        ["Driver", "Completed jobs", "Takings (GBP)", "Company commission (GBP)", "Driver earnings (GBP)", "Cash held by driver (GBP)", "Card/account held by company (GBP)", "Balance"].map(cell).join(","),
        ...set.map((d) =>
          [
            d.name,
            d.jobs,
            d.takings.toFixed(2),
            d.company.toFixed(2),
            d.driver.toFixed(2),
            d.cashHeld.toFixed(2),
            d.companyHeld.toFixed(2),
            balanceLabel(d.balance) + (d.rateMissing ? ` (commission not set on ${d.rateMissing} job${d.rateMissing === 1 ? "" : "s"})` : ""),
          ]
            .map(cell)
            .join(",")
        ),
      ]
    : [];
  return "﻿" + [head.map(cell).join(","), ...lines, ...summary].join("\r\n");
}
