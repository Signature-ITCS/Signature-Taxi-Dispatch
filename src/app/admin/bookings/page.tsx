"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import {
  Loader2,
  Search,
  FileDown,
  ExternalLink,
  ClipboardList,
  X,
  User,
  Users,
  Phone,
  Mail,
  MapPin,
  Navigation,
  CircleDot,
  Baby,
  Banknote,
  CreditCard,
  CalendarClock,
  StickyNote,
  Repeat,
  Route,
  Star,
  Sheet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Pagination, { usePageState } from "@/components/dashboard/Pagination";
import DriverSearch, { type SearchableDriver } from "@/components/dashboard/DriverSearch";
import { fetchReportRows, filtersToParams, toCsv, type ReportFilters } from "@/lib/bookingReport";
import PageHeader from "@/components/admin/PageHeader";
import LoadError from "@/components/dashboard/LoadError";
import ExternalBookingModal from "@/components/dashboard/ExternalBookingModal";
import StatusBadge from "@/components/dashboard/StatusBadge";
import SheetHandle from "@/components/dashboard/SheetHandle";
import { money, clock, cn, dateTimeFull } from "@/lib/format";
import { STATUS_META, JOB_STATUS_META } from "@/lib/constants";
import type { Booking, BookingStatus, JobStatus, PaymentMethod, PaymentStatus } from "@/lib/types";

interface Row extends Booking {
  category?: { name: string } | null;
  source?: { name: string } | null;
  driver?: { full_name: string } | null;
  review?: { rating: number; comment: string | null; created_at: string }[] | null;
}

const FILTERS: (BookingStatus | "all")[] = ["all", "pending", "in_progress", "completed", "cancelled"];

const JOB_STATUSES: JobStatus[] = ["processing", "completed", "cancelled", "refunded"];
/** Button wording — "refunded" also cancels the ride. */
const JOB_BUTTON_LABEL: Partial<Record<JobStatus, string>> = { refunded: "Refunded & cancelled" };

/** How staff record payment by hand. Website card payments arrive already "card". */
type PaymentChoice = "unpaid" | "card" | "cash";
const PAYMENT_CHOICES: { key: PaymentChoice; label: string; Icon: typeof CreditCard }[] = [
  { key: "unpaid", label: "Unpaid", Icon: CircleDot },
  { key: "card", label: "Paid by card", Icon: CreditCard },
  { key: "cash", label: "Paid by cash", Icon: Banknote },
];

/**
 * The job status, shown only when it says something the ride status doesn't:
 * "Processing" is the everyday default, and Completed / Cancelled are already
 * carried by the ride status they set.
 */
function JobStatusBadge({ status, rideStatus }: { status: JobStatus | null | undefined; rideStatus: BookingStatus }) {
  if (!status || status === "processing" || status === rideStatus) return null;
  const m = JOB_STATUS_META[status] ?? JOB_STATUS_META.processing;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", m.bg, m.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

/**
 * Who drove this job. Rides handed to another company have no `drivers` row —
 * their name sits on the booking itself, so fall back to that before giving up.
 */
function driverLabel(r: Row, fallback: string): string {
  if (r.driver?.full_name) return r.driver.full_name;
  if (r.external_provider) return "Outside job";
  if (r.external_driver_name) {
    return r.external_driver_company
      ? `${r.external_driver_name} (${r.external_driver_company})`
      : `${r.external_driver_name} (outside)`;
  }
  return fallback;
}

export default function BookingsPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<BookingStatus | "all">("all");
  const [q, setQ] = useState("");
  // Opened from a notification: /bookings?q=<booking ref> pre-fills the search.
  const searchParams = useSearchParams();
  const urlQ = searchParams.get("q");
  useEffect(() => {
    if (urlQ) setQ(urlQ);
  }, [urlQ]);
  const [detail, setDetail] = useState<Row | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showExternal, setShowExternal] = useState(false);
  const [showReport, setShowReport] = useState(false);

  // Paged in the database: only the rows on screen are fetched, so every
  // booking ever taken is reachable however many there are.
  const { page, setPage, pageSize, setPageSize } = usePageState("bookings", 25);
  const [total, setTotal] = useState(0);
  // Search as you type, without a query per keystroke.
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [search, filter, setPage]);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("bookings")
      .select(
        "*, category:vehicle_categories!bookings_vehicle_category_id_fkey(name), source:websites(name), driver:drivers(full_name), review:ratings(rating, comment, created_at)",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (filter !== "all") query = query.eq("status", filter);
    if (search) {
      // Characters that would break the filter syntax are dropped, not escaped.
      const t = search.replace(/[,()%*\\"]/g, " ").trim();
      if (t) {
        query = query.or(
          [
            `booking_number.ilike.%${t}%`,
            `customer_name.ilike.%${t}%`,
            `customer_whatsapp.ilike.%${t}%`,
            `pickup_address.ilike.%${t}%`,
            `dropoff_address.ilike.%${t}%`,
          ].join(",")
        );
      }
    }
    const { data, error, count } = await query;
    // An empty list and a failed query look identical on screen — say which it is.
    if (error) console.error("[bookings] load failed", error);
    setLoadError(error?.message ?? null);
    setRows((data as Row[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [supabase, page, pageSize, filter, search]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = rows;

  return (
    <div>
      <PageHeader
        title="Bookings"
        subtitle="Complete booking history"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowReport(true)}
              className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:text-ink-950"
            >
              <FileDown className="h-4 w-4" /> <span className="hidden sm:inline">Report</span>
            </button>
            <button
              onClick={() => setShowExternal(true)}
              title="A job you arranged on Uber or with a partner firm"
              className="flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100"
            >
              <ExternalLink className="h-4 w-4" /> <span className="hidden sm:inline">Outside job</span>
            </button>
          </div>
        }
      />

      <div className="px-5 pb-10 md:px-8">
        {loadError && (
          <div className="mb-4">
            <LoadError what="bookings" detail={loadError} onRetry={load} />
          </div>
        )}

        {/* Controls */}
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1 md:min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search bookings…"
              // 16px on phones so iOS Safari doesn't auto-zoom the page on focus
              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-base outline-none focus:border-brand-400 md:text-sm"
            />
          </div>
          {/* Filter chips scroll sideways on phones instead of wrapping */}
          <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-0.5 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold capitalize transition-colors",
                  filter === f ? "bg-ink-950 text-white" : "bg-white text-gray-500 hover:bg-gray-100 border border-gray-200"
                )}
              >
                {f === "all" ? "All" : STATUS_META[f as BookingStatus].label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-brand-600" />
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            {/* Phone: card list */}
            <div className="md:hidden">
              {filtered.map((r, i) => (
                <motion.button
                  key={r.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.02, 0.3) }}
                  onClick={() => setDetail(r)}
                  className="block w-full border-b border-gray-50 px-4 py-3 text-left last:border-0 active:bg-gray-50"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-mono text-xs font-semibold text-gray-500">{r.booking_number}</span>
                      {r.trip_group_id && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">
                          <Repeat className="h-2.5 w-2.5" /> {r.is_return ? "Return" : "Out"}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <JobStatusBadge status={r.job_status} rideStatus={r.status} />
                      <StatusBadge status={r.status} size="xs" />
                    </span>
                  </div>
                  <p className="flex items-center gap-1.5 text-sm font-medium text-ink-950">
                    <span className="truncate">{r.customer_name}</span>
                    {r.child_seat && <Baby className="h-3.5 w-3.5 shrink-0 text-brand-500" aria-label="Child seat requested" />}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-950">
                    <MapPin className="h-3 w-3 shrink-0 text-brand-500" />
                    <span className="truncate">{r.pickup_address}</span>
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Navigation className="h-3 w-3 shrink-0 text-gray-400" />
                    <span className="truncate">{r.dropoff_address}</span>
                  </p>
                  <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                    <span className="truncate">
                      {r.external_provider && (
                        <span className="mr-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                          Outside
                        </span>
                      )}
                      {driverLabel(r, "No driver")} · {r.source?.name ?? "—"} · {clock(r.created_at)}
                    </span>
                    <span className="shrink-0 font-display text-sm font-bold text-ink-950">{money(r.estimated_fare)}</span>
                  </div>
                </motion.button>
              ))}
            </div>
            {/* Tablet / desktop: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-5 py-3 font-semibold">Booking</th>
                    <th className="px-3 py-3 font-semibold">Customer</th>
                    <th className="px-3 py-3 font-semibold">Route</th>
                    <th className="px-3 py-3 font-semibold">Driver</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                    <th className="px-3 py-3 text-right font-semibold">Fare</th>
                    <th className="px-5 py-3 text-right font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <motion.tr
                      key={r.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(i * 0.02, 0.3) }}
                      onClick={() => setDetail(r)}
                      className="cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50/60"
                    >
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-semibold text-gray-500">{r.booking_number}</span>
                          {r.trip_group_id && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">
                              <Repeat className="h-2.5 w-2.5" /> {r.is_return ? "Return" : "Outbound"}
                            </span>
                          )}
                        </span>
                        <p className="text-[11px] text-gray-400">{r.source?.name ?? "—"}</p>
                      </td>
                      <td className="px-3 py-3 text-ink-950">
                        <span className="flex items-center gap-1.5">
                          {r.customer_name}
                          {r.child_seat && (
                            <Baby className="h-3.5 w-3.5 text-brand-500" aria-label="Child seat requested" />
                          )}
                        </span>
                      </td>
                      <td className="max-w-[240px] px-3 py-3">
                        <p className="truncate text-ink-950">{r.pickup_address}</p>
                        <p className="truncate text-xs text-gray-400">→ {r.dropoff_address}</p>
                      </td>
                      <td className="px-3 py-3 text-gray-500">
                        {r.external_provider && (
                          <span className="mr-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                            Outside
                          </span>
                        )}
                        {driverLabel(r, "—")}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge status={r.status} size="xs" />
                          <JobStatusBadge status={r.job_status} rideStatus={r.status} />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-display font-bold text-ink-950">{money(r.estimated_fare)}</td>
                      <td className="px-5 py-3 text-right text-xs text-gray-400">{clock(r.created_at)}</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && !loading && (
              <div className="py-12 text-center text-sm text-gray-400">
                <ClipboardList className="mx-auto mb-2 h-8 w-8 text-gray-300" /> No bookings match
              </div>
            )}
          </div>
        )}

        <Pagination
          className="mt-4"
          page={page}
          pageSize={pageSize}
          total={total}
          onPage={setPage}
          onPageSize={setPageSize}
        />
      </div>

      {showExternal && (
        <ExternalBookingModal onClose={() => setShowExternal(false)} onSaved={() => load()} />
      )}

      {showReport && <ReportModal onClose={() => setShowReport(false)} currentStatus={filter} />}

      {detail && (
        <BookingDetailModal
          row={detail}
          linked={
            detail.trip_group_id
              ? rows.find((r) => r.trip_group_id === detail.trip_group_id && r.id !== detail.id) ?? null
              : null
          }
          onClose={() => setDetail(null)}
          onChanged={(id, patch) => setRows((rs) => rs.map((x) => (x.id === id ? { ...x, ...patch } : x)))}
        />
      )}
    </div>
  );
}

function BookingDetailModal({
  row,
  linked,
  onClose,
  onChanged,
}: {
  row: Row;
  linked?: Row | null;
  onClose: () => void;
  onChanged: (id: string, patch: Partial<Row>) => void;
}) {
  const vias = (row.via_points ?? []).filter((v) => v.address);
  const review = row.review?.[0] ?? null;
  // Off-platform jobs have no driver and no dispatch flow moving them along, so
  // their status is whatever the office says it is.
  const [status, setStatus] = useState<BookingStatus>(row.status);
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusErr, setStatusErr] = useState<string | null>(null);

  const changeStatus = async (next: BookingStatus) => {
    const previous = status;
    setStatus(next);
    setSavingStatus(true);
    setStatusErr(null);
    const supabase = createClient();
    const { error } = await supabase.from("bookings").update({ status: next }).eq("id", row.id);
    setSavingStatus(false);
    if (error) {
      setStatus(previous);
      setStatusErr("Could not update the status. Please try again.");
      return;
    }
    onChanged(row.id, { status: next });
  };

  // ── Office controls: job status and payment, set by hand ────────────────
  // Refunds are NOT done from here — money goes back from the Stripe Dashboard,
  // and staff then mark the job "Refunded".
  const [jobStatus, setJobStatus] = useState<JobStatus>(row.job_status ?? "processing");
  const [pay, setPay] = useState<{ method: PaymentMethod; status: PaymentStatus }>({
    method: row.payment_method,
    status: row.payment_status,
  });
  const [savingOffice, setSavingOffice] = useState(false);
  const [officeErr, setOfficeErr] = useState<string | null>(null);

  const saveOffice = async (
    patch: Partial<Pick<Row, "job_status" | "status" | "payment_method" | "payment_status">>
  ) => {
    setSavingOffice(true);
    setOfficeErr(null);
    const supabase = createClient();
    const { error } = await supabase.from("bookings").update(patch).eq("id", row.id);
    setSavingOffice(false);
    if (error) {
      setOfficeErr("Could not save the change. Please try again.");
      return false;
    }
    onChanged(row.id, patch);
    return true;
  };

  const changeJobStatus = async (next: JobStatus) => {
    const previous = { job: jobStatus, ride: status };
    // Completed / Cancelled / Refunded close the ride itself too, so the
    // bookings list, its filters and the dispatch board all agree. Processing
    // is an office note and leaves the ride where it is.
    const ride: BookingStatus | null =
      next === "completed" || next === "cancelled" ? next : next === "refunded" ? "cancelled" : null;
    setJobStatus(next);
    if (ride) setStatus(ride);
    if (!(await saveOffice(ride ? { job_status: next, status: ride } : { job_status: next }))) {
      setJobStatus(previous.job);
      setStatus(previous.ride);
    }
  };

  const changePayment = async (next: PaymentChoice) => {
    const previous = pay;
    const target =
      next === "unpaid"
        ? { method: pay.method, status: "pending" as PaymentStatus }
        : { method: (next === "card" ? "card" : "cash") as PaymentMethod, status: "paid" as PaymentStatus };
    setPay(target);
    if (!(await saveOffice({ payment_method: target.method, payment_status: target.status }))) setPay(previous);
  };

  const payChoice: PaymentChoice | null =
    pay.status === "paid" ? (pay.method === "card" ? "card" : "cash") : pay.status === "pending" ? "unpaid" : null;
  const paidOnline = !!row.stripe_payment_intent_id;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-xl sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl sm:p-6"
      >
        <SheetHandle />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-gray-500">{row.booking_number}</span>
              <StatusBadge status={status} size="xs" />
              <JobStatusBadge status={jobStatus} rideStatus={status} />
            </div>
            <p className="mt-0.5 text-xs text-gray-400">
              {row.source?.name ?? "—"} · {clock(row.created_at)}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Customer */}
        <Section title="Customer">
          <DetailRow icon={User} label="Name" value={row.customer_name} />
          <DetailRow icon={Phone} label="WhatsApp" value={row.customer_whatsapp} />
          <DetailRow icon={Mail} label="Email" value={row.customer_email ?? "—"} />
        </Section>

        {/* Trip */}
        <Section title="Trip">
          <DetailRow icon={MapPin} label="Pick-up" value={row.pickup_address} iconClass="text-brand-500" />
          {vias.map((v, i) => (
            <DetailRow key={i} icon={CircleDot} label={`Via ${i + 1}`} value={v.address} iconClass="text-gray-400" />
          ))}
          <DetailRow icon={Navigation} label="Drop-off" value={row.dropoff_address} iconClass="text-ink-950" />
          {row.distance_km != null && (
            <DetailRow
              icon={Route}
              label="Distance"
              value={`${row.distance_km} mi${row.duration_min != null ? ` · ~${row.duration_min} min` : ""}`}
            />
          )}
          <DetailRow
            icon={CalendarClock}
            label="When"
            value={row.scheduled_at ? dateTimeFull(row.scheduled_at) : "As soon as possible"}
          />
          {linked && (
            <DetailRow
              icon={Repeat}
              label={row.is_return ? "Outbound" : "Return"}
              value={linked.booking_number}
              iconClass="text-indigo-500"
              highlight
            />
          )}
        </Section>

        {/* Booking */}
        <Section title="Booking">
          <DetailRow
            icon={row.payment_method === "cash" ? Banknote : CreditCard}
            label="Payment"
            value={`${row.payment_method === "cash" ? "Cash" : "Card"} · ${row.category?.name ?? "—"}`}
          />
          <DetailRow
            icon={Users}
            label="Load"
            value={`${row.passengers} passengers · ${row.suitcases} suitcases · ${row.hand_luggage} hand luggage`}
          />
          <DetailRow
            icon={Baby}
            label="Child seat"
            value={row.child_seat ? "Required" : "Not required"}
            iconClass={row.child_seat ? "text-brand-500" : "text-gray-300"}
            highlight={row.child_seat}
          />
          <DetailRow icon={StickyNote} label="Notes" value={row.notes?.trim() || "—"} />
          <DriverPicker row={row} status={status} onAssigned={(patch) => { if (patch.status) setStatus(patch.status); onChanged(row.id, patch); }} />
        </Section>

        {/* Customer rating (shown once the ride is rated) */}
        {review && (
          <Section title="Customer rating">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={cn(
                      "h-4 w-4",
                      n <= review.rating ? "fill-brand-400 text-brand-400" : "text-gray-200"
                    )}
                  />
                ))}
              </div>
              <span className="text-sm font-semibold text-ink-950">{review.rating}/5</span>
              <span className="text-xs text-gray-400">· {clock(review.created_at)}</span>
            </div>
            {review.comment?.trim() && (
              <p className="mt-1 text-sm italic text-gray-600">“{review.comment.trim()}”</p>
            )}
          </Section>
        )}

        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-brand-800">
              {pay.status === "paid" ? "Paid" : pay.status === "refunded" ? "Refunded" : "Estimated fare"}
            </span>
            <span className="font-display text-xl font-bold text-ink-950">{money(row.estimated_fare)}</span>
          </div>
        </div>

        {/* Office controls — admin and dispatch set these by hand */}
        <div className="mt-4 space-y-4 rounded-xl border border-gray-200 p-3.5">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">Job status</p>
            <div className="flex flex-wrap gap-1.5">
              {JOB_STATUSES.map((v) => (
                <button
                  key={v}
                  onClick={() => changeJobStatus(v)}
                  // A selected Completed / Cancelled can be pressed again when the ride
                  // never followed (bookings marked before the two were linked).
                  disabled={
                    savingOffice ||
                    (jobStatus === v &&
                      !(
                        ((v === "completed" || v === "cancelled") && status !== v) ||
                        (v === "refunded" && status !== "cancelled")
                      ))
                  }
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                    jobStatus === v
                      ? "border-ink-950 bg-ink-950 text-white"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  )}
                >
                  {JOB_BUTTON_LABEL[v] ?? JOB_STATUS_META[v].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">Payment</p>
            <div className="flex flex-wrap gap-1.5">
              {PAYMENT_CHOICES.map((c) => (
                <button
                  key={c.key}
                  onClick={() => changePayment(c.key)}
                  disabled={savingOffice || payChoice === c.key}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                    payChoice === c.key
                      ? c.key === "unpaid"
                        ? "border-amber-500 bg-amber-500 text-white"
                        : "border-green-600 bg-green-600 text-white"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  )}
                >
                  <c.Icon className="h-3.5 w-3.5" /> {c.label}
                </button>
              ))}
            </div>
            {pay.status === "refunded" && (
              <p className="mt-2 text-xs text-gray-500">The card payment for this ride was refunded.</p>
            )}
            {paidOnline && (
              <p className="mt-2 text-xs text-gray-500">Paid online by card through Stripe.</p>
            )}
          </div>

          {officeErr && <p className="text-xs text-red-600">{officeErr}</p>}
        </div>

        {row.external_provider && (
          <div className="mb-1">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">Status</p>
            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3.5">
              <p className="mb-2 text-[13px] text-violet-900">
                This job was arranged outside the app, so there is no driver moving it along — set where it got to.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(["pending", "in_progress", "completed", "cancelled"] as BookingStatus[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => changeStatus(v)}
                    disabled={savingStatus || status === v}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize transition-colors",
                      status === v
                        ? "border-violet-500 bg-violet-600 text-white"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    )}
                  >
                    {v.replace("_", " ")}
                  </button>
                ))}
                {savingStatus && <Loader2 className="h-4 w-4 animate-spin self-center text-violet-600" />}
              </div>
              {statusErr && <p className="mt-2 text-xs text-red-600">{statusErr}</p>}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">{title}</p>
      <div className="space-y-2.5 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5">{children}</div>
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  iconClass = "text-gray-400",
  highlight = false,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  iconClass?: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconClass)} />
      <span className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      <span className={cn("min-w-0 flex-1 break-words", highlight ? "font-semibold text-brand-700" : "text-ink-950")}>
        {value}
      </span>
    </div>
  );
}

/**
 * Date range for the printable report.
 *
 * Defaults to this month, which is what someone reaching for a report almost
 * always wants. The report itself opens in a new tab and puts up the print
 * dialog; "Save as PDF" there is the download.
 */
function ReportModal({ onClose, currentStatus }: { onClose: () => void; currentStatus: BookingStatus | "all" }) {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const [from, setFrom] = useState(iso(firstOfMonth));
  const [to, setTo] = useState(iso(today));
  const [status, setStatus] = useState<BookingStatus | "all">(currentStatus);
  const [payment, setPayment] = useState<ReportFilters["payment"]>("all");
  const [driver, setDriver] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<SearchableDriver[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Every driver, including blocked ones — their past jobs still need reports.
  useEffect(() => {
    createClient()
      .from("drivers")
      .select("id, full_name, phone, whatsapp, service_area")
      .order("full_name")
      .then(({ data }) => setDrivers((data as SearchableDriver[]) ?? []));
  }, []);

  const filters: ReportFilters = { from, to, status, payment, driver };
  const driverName = drivers.find((d) => d.id === driver)?.full_name;

  const openPdf = () => {
    const qs = filtersToParams(filters);
    if (driverName) qs.set("driver_name", driverName);
    window.open(`/admin/bookings/print?${qs}`, "_blank", "noopener");
    onClose();
  };

  const downloadCsv = async () => {
    setDownloading(true);
    setMsg(null);
    const { rows, error } = await fetchReportRows(createClient(), filters);
    setDownloading(false);
    if (error) return setMsg(`Could not load the bookings: ${error}`);
    if (rows.length === 0) return setMsg("No bookings match these filters.");
    const name = [
      "bookings",
      from,
      to,
      payment !== "all" ? payment : null,
      driverName ? driverName.replace(/[^A-Za-z0-9]+/g, "-") : null,
    ]
      .filter(Boolean)
      .join("_");
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg(`Downloaded ${rows.length} booking${rows.length === 1 ? "" : "s"}.`);
  };

  const label = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-3xl bg-white p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-xl sm:max-w-md sm:rounded-2xl sm:pb-5"
      >
        <h3 className="font-display text-lg font-bold text-ink-950">Export bookings</h3>
        <p className="mt-0.5 text-sm text-gray-500">Filter, then open a printable report (PDF) or download a spreadsheet.</p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="block">
            <span className={label}>From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
            />
          </label>
          <label className="block">
            <span className={label}>To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
            />
          </label>
        </div>

        <div className="mt-3">
          <span className={label}>Payment</span>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                ["all", "All"],
                ["cash", "Cash jobs"],
                ["card", "Card jobs"],
              ] as const
            ).map(([k, t]) => (
              <button
                key={k}
                type="button"
                onClick={() => setPayment(k)}
                className={cn(
                  "rounded-lg border py-2 text-sm font-semibold",
                  payment === k ? "border-ink-950 bg-ink-950 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <span className={label}>Driver</span>
          <DriverSearch drivers={drivers} value={driver} onChange={setDriver} allowClear clearLabel="All drivers" />
        </div>

        <label className="mt-3 block">
          <span className={label}>Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as BookingStatus | "all")}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm capitalize outline-none focus:border-brand-400"
          >
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {f === "all" ? "All statuses" : f.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>

        {msg && <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">{msg}</p>}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={openPdf}
            className="flex items-center justify-center gap-2 rounded-xl bg-ink-950 py-3 text-sm font-bold text-white hover:bg-ink-800"
          >
            <FileDown className="h-4 w-4" /> PDF report
          </button>
          <button
            onClick={downloadCsv}
            disabled={downloading}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand-500 py-3 text-sm font-bold text-white hover:bg-brand-600 disabled:bg-gray-300"
          >
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sheet className="h-4 w-4" />} Spreadsheet (CSV)
          </button>
        </div>
        <button onClick={onClose} className="mt-2 w-full rounded-xl border border-gray-200 py-2.5 text-sm text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
      </motion.div>
    </div>
  );
}

interface PickDriver {
  id: string;
  full_name: string;
  availability: "offline" | "online" | "on_trip";
  profile_id: string | null;
  phone: string | null;
  whatsapp: string | null;
  service_area: string | null;
}

/**
 * Who is on this job, and — while it is still open — a picker to assign or
 * change the driver. Assigning sends the driver app's "new job" alert. A busy
 * app driver can't be given a second job.
 */
function DriverPicker({
  row,
  status,
  onAssigned,
}: {
  row: Row;
  status: BookingStatus;
  onAssigned: (patch: Partial<Row>) => void;
}) {
  const closed = status === "completed" || status === "cancelled";
  const [drivers, setDrivers] = useState<PickDriver[] | null>(null);
  const [driverId, setDriverId] = useState<string>(row.driver_id ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (closed) return;
    createClient()
      .from("drivers")
      .select("id, full_name, availability, profile_id, phone, whatsapp, service_area")
      .eq("is_approved", true)
      .eq("is_blocked", false)
      .order("full_name")
      .then(({ data }) => setDrivers((data as PickDriver[]) ?? []));
  }, [closed]);

  const label = status === "completed" ? "Completed by" : "Driver";
  if (closed || row.external_provider || row.external_driver_name) {
    return <DetailRow icon={User} label={label} value={driverLabel(row, status === "completed" ? "Not recorded" : "Not assigned")} />;
  }

  const assign = async (id: string) => {
    if (!id || id === row.driver_id) return;
    const d = drivers?.find((x) => x.id === id);
    if (d?.profile_id && d.availability === "on_trip") {
      setErr(`${d.full_name} is busy on another job.`);
      return;
    }
    setSaving(true);
    setErr(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const patch = { driver_id: id, status: "assigned" as BookingStatus, dispatcher_id: user?.id ?? null };
    const { error } = await supabase.from("bookings").update(patch).eq("id", row.id);
    setSaving(false);
    if (error) {
      setErr("Could not assign the driver. Try again.");
      return;
    }
    setDriverId(id);
    onAssigned({ ...patch, driver: d ? { full_name: d.full_name } : row.driver });
  };

  const tag = (d: PickDriver) =>
    !d.profile_id ? "" : d.availability === "on_trip" ? " — busy" : d.availability === "offline" ? " — offline" : " — available";

  return (
    <div className="flex items-start gap-3 py-1.5">
      <User className="mt-1 h-4 w-4 shrink-0 text-gray-400" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Driver</p>
        <div className="mt-1 flex items-center gap-2">
          <DriverSearch
            className="flex-1"
            disabled={saving || drivers === null}
            placeholder={drivers === null ? "Loading drivers…" : "Type a driver's name to assign…"}
            value={driverId || null}
            onChange={(id) => id && assign(id)}
            drivers={(drivers ?? []).map((d) => ({
              ...d,
              tag: tag(d).replace(" — ", ""),
              disabled: !!d.profile_id && d.availability === "on_trip" && d.id !== row.driver_id,
            }))}
          />
          {saving && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-500" />}
        </div>
        {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      </div>
    </div>
  );
}
