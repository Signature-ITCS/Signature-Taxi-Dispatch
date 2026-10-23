"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, MapPin, Navigation, CalendarDays, User, Banknote, CreditCard } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import PageHeader from "@/components/admin/PageHeader";
import StatusBadge from "@/components/dashboard/StatusBadge";
import { cn, money } from "@/lib/format";
import type { BookingStatus } from "@/lib/types";

interface CalJob {
  id: string;
  booking_number: string;
  status: BookingStatus;
  scheduled_at: string | null;
  created_at: string;
  customer_name: string;
  customer_whatsapp: string | null;
  pickup_address: string;
  dropoff_address: string;
  payment_method: string;
  estimated_fare: number | null;
  final_fare: number | null;
  driver_id: string | null;
  external_driver_name: string | null;
  driver: { full_name: string } | null;
}

const FIELDS =
  "id, booking_number, status, scheduled_at, created_at, customer_name, customer_whatsapp, pickup_address, dropoff_address, payment_method, estimated_fare, final_fare, driver_id, external_driver_name, driver:drivers(full_name)";

/** "2026-10-15" for a moment, in UK time — the day a journey belongs to. */
const ukDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** When the journey happens: the booked time, or (for "as soon as possible") when it was booked. */
const whenOf = (j: CalJob) => j.scheduled_at ?? j.created_at;

/**
 * Dispatch → Calendar. A month at a glance — how many journeys each day — and
 * the day's list underneath, so the office can plan drivers for busy days.
 */
export default function CalendarPage() {
  const [supabase] = useState(() => createClient());
  const today = ukDay(new Date().toISOString());
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)) - 1);
  const [selected, setSelected] = useState(today);
  const [jobs, setJobs] = useState<CalJob[] | null>(null);

  const load = useCallback(async () => {
    setJobs(null);
    // A few days either side of the month covers time zones and the grid's edges.
    const from = new Date(Date.UTC(year, month, 1) - 2 * 86_400_000).toISOString();
    const to = new Date(Date.UTC(year, month + 1, 1) + 2 * 86_400_000).toISOString();
    const [scheduled, asap] = await Promise.all([
      supabase.from("bookings").select(FIELDS).gte("scheduled_at", from).lt("scheduled_at", to).limit(3000),
      supabase.from("bookings").select(FIELDS).is("scheduled_at", null).gte("created_at", from).lt("created_at", to).limit(3000),
    ]);
    setJobs([...((scheduled.data as unknown as CalJob[]) ?? []), ...((asap.data as unknown as CalJob[]) ?? [])]);
  }, [supabase, year, month]);

  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalJob[]>();
    for (const j of jobs ?? []) {
      const k = ukDay(whenOf(j));
      (map.get(k) ?? map.set(k, []).get(k)!).push(j);
    }
    for (const list of map.values()) list.sort((a, b) => whenOf(a).localeCompare(whenOf(b)));
    return map;
  }, [jobs]);

  // Monday-first grid for the month.
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  const shift = (delta: number) => {
    const d = new Date(Date.UTC(year, month + delta, 1));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth());
  };
  const goToday = () => {
    setYear(Number(today.slice(0, 4)));
    setMonth(Number(today.slice(5, 7)) - 1);
    setSelected(today);
  };

  const monthLabel = first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const dayJobs = byDay.get(selected) ?? [];
  const selectedLabel = new Date(`${selected}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const fare = (j: CalJob) => Number(j.final_fare ?? j.estimated_fare ?? 0);

  return (
    <div>
      <PageHeader help="calendar-map#calendar" title="Calendar" subtitle="Journeys by day — plan drivers ahead of busy days" />
      <div className="grid gap-5 px-5 pb-24 md:px-8 md:pb-10 lg:grid-cols-[1fr_380px]">
        {/* Month */}
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-ink-950">{monthLabel}</h2>
            <div className="flex items-center gap-1">
              <button onClick={goToday} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                Today
              </button>
              <button onClick={() => shift(-1)} aria-label="Previous month" className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button onClick={() => shift(1)} aria-label="Next month" className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="relative grid grid-cols-7 gap-1">
            {jobs === null && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
                <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
              </div>
            )}
            {cells.map((d, i) => {
              if (d === null) return <div key={`e${i}`} />;
              const k = dayKey(year, month, d);
              const list = byDay.get(k) ?? [];
              const active = list.filter((j) => j.status !== "cancelled");
              const open = active.filter((j) => j.status !== "completed").length;
              const unassigned = active.filter((j) => j.status === "pending" && !j.driver_id && !j.external_driver_name).length;
              return (
                <button
                  key={k}
                  onClick={() => setSelected(k)}
                  className={cn(
                    "flex min-h-16 flex-col items-start rounded-xl border p-1.5 text-left transition-colors sm:min-h-20 sm:p-2",
                    k === selected ? "border-brand-500 bg-brand-50" : "border-gray-100 hover:bg-gray-50",
                    k < today && "opacity-60"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                      k === today ? "bg-ink-950 text-white" : "text-ink-950"
                    )}
                  >
                    {d}
                  </span>
                  {active.length > 0 && (
                    <span className="mt-auto w-full space-y-0.5">
                      <span className="block truncate rounded-md bg-brand-500 px-1 text-[10px] font-bold text-white sm:text-[11px]">
                        {active.length} {active.length === 1 ? "job" : "jobs"}
                      </span>
                      {unassigned > 0 && k >= today && (
                        <span className="block truncate rounded-md bg-red-100 px-1 text-[10px] font-bold text-red-700">
                          {unassigned} no driver
                        </span>
                      )}
                      {open > 0 && k < today && (
                        <span className="block truncate text-[10px] text-gray-500">{open} open</span>
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Day */}
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
            <CalendarDays className="h-5 w-5 text-brand-600" /> {selectedLabel}
          </h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {dayJobs.length === 0
              ? "No journeys."
              : `${dayJobs.length} ${dayJobs.length === 1 ? "journey" : "journeys"} · ${money(
                  dayJobs.filter((j) => j.status !== "cancelled").reduce((s, j) => s + fare(j), 0)
                )}`}
          </p>
          <div className="mt-3 space-y-2 lg:max-h-[calc(100vh-260px)] lg:overflow-y-auto">
            {dayJobs.map((j) => (
              <div key={j.id} className={cn("rounded-xl border border-gray-100 p-3", j.status === "cancelled" && "opacity-50")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-base font-bold text-ink-950">
                    {j.scheduled_at
                      ? new Date(j.scheduled_at).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })
                      : "ASAP"}
                  </span>
                  <StatusBadge status={j.status} size="xs" />
                </div>
                <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-950">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" /> {j.pickup_address}
                </p>
                <p className="flex items-start gap-1.5 text-sm text-gray-500">
                  <Navigation className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {j.dropoff_address}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <User className="h-3.5 w-3.5" /> {j.customer_name}
                    <span className="text-gray-300">·</span>
                    {j.driver?.full_name ?? j.external_driver_name ?? (
                      <span className={cn("font-semibold", j.status === "pending" ? "text-red-600" : "")}>No driver</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1 font-semibold text-ink-950">
                    {j.payment_method === "cash" ? <Banknote className="h-3.5 w-3.5" /> : <CreditCard className="h-3.5 w-3.5" />}
                    {money(fare(j))}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-gray-400">{j.booking_number}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
