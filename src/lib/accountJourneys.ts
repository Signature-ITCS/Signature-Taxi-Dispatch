/**
 * Account journeys by calendar month (UK time) — shared by the Accounts screen
 * (browser) and the invoice code (server). No server-only imports here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type InvoiceJourney = {
  id: string;
  booking_number: string | null;
  customer_name: string;
  pickup_address: string;
  dropoff_address: string;
  scheduled_at: string | null;
  created_at: string;
  completed_at: string | null;
  status: string;
  final_fare: number | null;
  estimated_fare: number | null;
  notes: string | null;
};

export const journeyFare = (j: Pick<InvoiceJourney, "final_fare" | "estimated_fare">) => Number(j.final_fare ?? j.estimated_fare ?? 0);
export const journeyTime = (j: Pick<InvoiceJourney, "scheduled_at" | "created_at">) => j.scheduled_at ?? j.created_at;

/* ───────────────────────────── months (UK time) ───────────────────────────── */

/** Minutes London is ahead of UTC at a given instant (0 or 60). */
function londonOffsetMin(at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value])
  );
  const asIfUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return Math.round((asIfUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** UTC instant of 00:00 London time on the 1st of a month (month is 1–12). */
function londonMonthStart(year: number, month: number): Date {
  const guess = new Date(Date.UTC(year, month - 1, 1));
  return new Date(guess.getTime() - londonOffsetMin(guess) * 60_000);
}

export function isMonth(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** "2026-10" → its boundaries, plain dates for the invoice and a label. */
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const from = londonMonthStart(y, m);
  const to = m === 12 ? londonMonthStart(y + 1, 1) : londonMonthStart(y, m + 1);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    from,
    to,
    periodStart: `${y}-${pad(m)}-01`,
    periodEnd: `${y}-${pad(m)}-${pad(lastDay)}`,
    label: new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

/** The month before the given instant, in London time, as "YYYY-MM". */
export function previousMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit" }).formatToParts(now);
  let y = Number(parts.find((p) => p.type === "year")?.value);
  let m = Number(parts.find((p) => p.type === "month")?.value) - 1;
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/* ───────────────────────────── data ───────────────────────────── */

const JOURNEY_COLS =
  "id, booking_number, customer_name, pickup_address, dropoff_address, scheduled_at, created_at, completed_at, status, final_fare, estimated_fare, notes";

/** Every journey on an account in a month (all statuses), oldest first. */
export async function accountJourneys(db: SupabaseClient, accountId: string, month: string): Promise<InvoiceJourney[]> {
  const { from, to } = monthRange(month);
  const f = from.toISOString();
  const t = to.toISOString();
  const { data, error } = await db
    .from("bookings")
    .select(JOURNEY_COLS)
    .eq("account_id", accountId)
    .eq("payment_method", "account")
    .or(`and(scheduled_at.gte.${f},scheduled_at.lt.${t}),and(scheduled_at.is.null,created_at.gte.${f},created_at.lt.${t})`)
    .limit(5000);
  if (error) throw new Error(error.message);
  return ((data as InvoiceJourney[]) ?? []).sort((a, b) => journeyTime(a).localeCompare(journeyTime(b)));
}

/** Only the journeys that are billed: completed ones. */
export const billable = (js: InvoiceJourney[]) => js.filter((j) => j.status === "completed");

/** This month in London time, as "YYYY-MM". */
export function currentMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}`;
}

/** The last `n` months, newest first: ["2026-11", "2026-10", …]. */
export function recentMonths(n = 12, now = new Date()): string[] {
  let [y, m] = currentMonth(now).split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}
