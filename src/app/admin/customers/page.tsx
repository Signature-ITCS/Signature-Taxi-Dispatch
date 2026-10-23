"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Loader2,
  Ban,
  Phone,
  Mail,
  Users,
  X,
  MapPin,
  Navigation,
  CalendarClock,
  Car,
  ShieldCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import PageHeader from "@/components/admin/PageHeader";
import StatusBadge from "@/components/dashboard/StatusBadge";
import LoadError from "@/components/dashboard/LoadError";
import Pagination, { usePageState } from "@/components/dashboard/Pagination";
import SheetHandle from "@/components/dashboard/SheetHandle";
import { cn, timeAgo, money, clock, dateTime, dateOnly } from "@/lib/format";
import type { Customer, Booking } from "@/lib/types";

export default function CustomersPage() {
  const supabase = createClient();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Customer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Paged and searched in the database — every customer stays reachable.
  const { page, setPage, pageSize, setPageSize } = usePageState("customers", 25);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [search, setPage]);

  const load = async () => {
    let query = supabase
      .from("customers")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    const t = search.replace(/[,()%*\\"]/g, " ").trim();
    if (t) query = query.or(`full_name.ilike.%${t}%,whatsapp.ilike.%${t}%,email.ilike.%${t}%`);
    const { data, error, count } = await query;
    // An empty list and a failed query look identical on screen — say which it is.
    if (error) console.error("[customers] load failed", error);
    setLoadError(error?.message ?? null);
    setCustomers((data as Customer[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, search]);

  const toggleBlock = async (c: Customer) => {
    await supabase.from("customers").update({ is_blocked: !c.is_blocked }).eq("id", c.id);
    setDetail((d) => (d && d.id === c.id ? { ...d, is_blocked: !c.is_blocked } : d));
    load();
  };

  return (
    <div>
      <PageHeader help="customers" title="Customers" subtitle="Everyone who has booked a ride" />
      {loadError && (
        <div className="px-5 pb-4 md:px-8">
          <LoadError what="customers" detail={loadError} onRetry={load} />
        </div>
      )}
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-brand-600" />
        </div>
      ) : (
        <div className="px-5 pb-10 md:px-8">
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search customers by name, phone or email…"
              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-base outline-none focus:border-brand-400 md:text-sm"
            />
          </div>
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            {customers.length === 0 && (
              <div className="py-12 text-center text-sm text-gray-400">
                <Users className="mx-auto mb-2 h-8 w-8 text-gray-300" /> {search ? "No customer matches" : "No customers yet"}
              </div>
            )}
            {customers.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.3) }}
                onClick={() => setDetail(c)}
                className="flex cursor-pointer items-center justify-between gap-2 border-b border-gray-50 px-4 py-3.5 last:border-0 hover:bg-gray-50/60 sm:px-5 sm:py-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700">
                    {c.full_name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-950">{c.full_name}</p>
                    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-gray-400">
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3 shrink-0" /> {c.whatsapp}
                      </span>
                      <span className="flex max-w-full items-center gap-1">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{c.email || "No email"}</span>
                      </span>
                      <span>· {c.total_rides} rides</span>
                      <span className="hidden sm:inline">· joined {timeAgo(c.created_at)}</span>
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {c.is_blocked && (
                    <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600">Blocked</span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleBlock(c);
                    }}
                    className={cn("rounded-lg p-2 hover:bg-red-50", c.is_blocked ? "text-red-500" : "text-gray-400 hover:text-red-600")}
                    title={c.is_blocked ? "Unblock" : "Block"}
                  >
                    <Ban className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
          <Pagination
            className="mt-4"
            page={page}
            pageSize={pageSize}
            total={total}
            onPage={setPage}
            onPageSize={setPageSize}
          />
        </div>
      )}

      {detail && (
        <CustomerDetailModal customer={detail} onClose={() => setDetail(null)} onToggleBlock={toggleBlock} />
      )}
    </div>
  );
}

interface BookingRow extends Booking {
  category?: { name: string } | null;
}

function CustomerDetailModal({
  customer,
  onClose,
  onToggleBlock,
}: {
  customer: Customer;
  onClose: () => void;
  onToggleBlock: (c: Customer) => void;
}) {
  const supabase = createClient();
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*, category:vehicle_categories!bookings_vehicle_category_id_fkey(name)")
        .eq("customer_id", customer.id)
        .order("created_at", { ascending: false });
      if (error) console.error("[customer bookings] load failed", error);
      setLoadError(error?.message ?? null);
      setBookings((data as BookingRow[]) ?? []);
      setLoading(false);
    })();
  }, [customer.id, supabase]);

  const completed = bookings.filter((b) => b.status === "completed");
  const cancelled = bookings.filter((b) =>
    ["cancelled", "declined", "no_driver_found"].includes(b.status)
  );
  const spent = completed.reduce((s, b) => s + Number(b.final_fare ?? b.estimated_fare ?? 0), 0);
  const lastRide = bookings[0]?.created_at ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-xl sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl sm:p-6"
      >
        <SheetHandle />
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 text-lg font-bold text-blue-700">
              {customer.full_name.charAt(0)}
            </div>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-display text-lg font-bold leading-tight text-ink-950">
                <span className="truncate">{customer.full_name}</span>
                {customer.is_blocked && (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">Blocked</span>
                )}
              </p>
              <p className="text-xs text-gray-400">Joined {timeAgo(customer.created_at)}</p>
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Contact */}
        <div className="mb-4 space-y-2.5 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5">
          <Row icon={Phone} label="WhatsApp" value={customer.whatsapp} />
          <Row icon={Mail} label="Email" value={customer.email || "—"} />
          <Row
            icon={CalendarClock}
            label="Joined"
            value={dateOnly(customer.created_at)}
          />
        </div>

        {/* Stats */}
        <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatCard label="Total rides" value={String(customer.total_rides)} />
          <StatCard label="Completed" value={String(completed.length)} />
          <StatCard label="Cancelled" value={String(cancelled.length)} />
          <StatCard label="Total spent" value={money(spent)} />
        </div>

        {/* Bookings */}
        <p className="mb-2 flex flex-wrap items-center justify-between gap-x-2 text-xs font-bold uppercase tracking-wide text-gray-400">
          <span>Booking history</span>
          {lastRide && <span className="normal-case text-gray-400">Last: {dateTime(lastRide)}</span>}
        </p>
        {loading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
          </div>
        ) : loadError ? (
          <LoadError what="this customer's bookings" detail={loadError} />
        ) : bookings.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">No bookings yet</p>
        ) : (
          <div className="space-y-2">
            {bookings.map((b) => (
              <div key={b.id} className="rounded-xl border border-gray-100 p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-gray-500">{b.booking_number}</span>
                    <StatusBadge status={b.status} size="xs" />
                  </span>
                  <span className="font-display text-sm font-bold text-ink-950">{money(b.estimated_fare)}</span>
                </div>
                <p className="flex items-center gap-1.5 text-xs text-ink-950">
                  <MapPin className="h-3 w-3 shrink-0 text-brand-500" />
                  <span className="truncate">{b.pickup_address}</span>
                </p>
                <p className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Navigation className="h-3 w-3 shrink-0 text-gray-400" />
                  <span className="truncate">{b.dropoff_address}</span>
                </p>
                <p className="mt-1 flex items-center gap-2 text-[11px] text-gray-400">
                  <span className="flex items-center gap-1">
                    <Car className="h-3 w-3" /> {b.category?.name ?? "—"}
                  </span>
                  <span>· {clock(b.created_at)}</span>
                  {b.child_seat && <span>· 👶 Child seat</span>}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <button
          onClick={() => onToggleBlock(customer)}
          className={cn(
            "mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors",
            customer.is_blocked
              ? "bg-brand-600 text-white hover:bg-brand-700"
              : "border border-red-200 text-red-600 hover:bg-red-50"
          )}
        >
          {customer.is_blocked ? (
            <>
              <ShieldCheck className="h-4 w-4" /> Unblock customer
            </>
          ) : (
            <>
              <Ban className="h-4 w-4" /> Block customer
            </>
          )}
        </button>
      </motion.div>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
      <span className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      <span className="min-w-0 flex-1 break-words text-ink-950">{value}</span>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3 text-center">
      <p className="font-display text-lg font-bold text-ink-950">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
    </div>
  );
}
