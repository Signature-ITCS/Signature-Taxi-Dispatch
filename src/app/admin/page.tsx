"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  PoundSterling,
  ClipboardList,
  CheckCircle2,
  CarFront,
  TrendingUp,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import PageHeader from "@/components/admin/PageHeader";
import StatusBadge from "@/components/dashboard/StatusBadge";
import { money, timeAgo, cn } from "@/lib/format";
import type { Booking } from "@/lib/types";

export default function AdminOverview() {
  const supabase = createClient();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [driverCount, setDriverCount] = useState(0);
  const [onlineCount, setOnlineCount] = useState(0);
  const [totals, setTotals] = useState<{ revenue: number; bookings: number; completed: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: bk }, { data: dr }, { data: rs }] = await Promise.all([
        supabase.from("bookings").select("*").order("created_at", { ascending: false }).limit(500),
        supabase.from("drivers").select("is_approved,is_blocked"),
        supabase.rpc("revenue_stats", { p_days: 7 }),
      ]);
      setBookings((bk as Booking[]) ?? []);
      setDriverCount(dr?.length ?? 0);
      setOnlineCount((dr ?? []).filter((d) => d.is_approved && !d.is_blocked).length);
      if (rs?.ok)
        setTotals({ revenue: rs.total_revenue, bookings: rs.total_bookings, completed: rs.completed_count });
      setLoading(false);
    })();
  }, [supabase]);

  const active = bookings.filter((b) =>
    ["pending", "assigned", "accepted", "driver_arrived", "in_progress"].includes(b.status)
  ).length;

  // Totals span all rows via the server aggregate; fall back to the fetched slice.
  const revenue = totals?.revenue ?? bookings.filter((b) => b.status === "completed").reduce((s, b) => s + Number(b.final_fare ?? b.estimated_fare ?? 0), 0);
  const totalBookings = totals?.bookings ?? bookings.length;
  const completedCount = totals?.completed ?? bookings.filter((b) => b.status === "completed").length;

  const stats = [
    { label: "Revenue", value: money(revenue), icon: PoundSterling, tone: "emerald" },
    { label: "Total Bookings", value: String(totalBookings), icon: ClipboardList, tone: "blue" },
    { label: "Completed", value: String(completedCount), icon: CheckCircle2, tone: "violet" },
    { label: "Active Drivers", value: `${onlineCount}/${driverCount}`, icon: CarFront, tone: "amber" },
  ];

  const toneMap: Record<string, string> = {
    emerald: "bg-brand-50 text-brand-600",
    blue: "bg-blue-50 text-blue-600",
    violet: "bg-violet-50 text-violet-600",
    amber: "bg-brand-50 text-brand-600",
  };

  return (
    <div>
      <PageHeader title="Overview" subtitle="Business at a glance" />

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-brand-600" />
        </div>
      ) : (
        <div className="space-y-6 px-5 pb-10 md:px-8">
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
              >
                <div className={cn("mb-3 flex h-10 w-10 items-center justify-center rounded-xl", toneMap[s.tone])}>
                  <s.icon className="h-5 w-5" />
                </div>
                <p className="font-display text-2xl font-bold text-ink-950">{s.value}</p>
                <p className="text-sm text-gray-500">{s.label}</p>
              </motion.div>
            ))}
          </div>

          {/* Recent bookings */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="rounded-2xl border border-gray-100 bg-white shadow-sm"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
                <TrendingUp className="h-4 w-4 text-brand-600" /> Recent Bookings
              </h2>
              <span className="text-sm text-gray-400">{active} active now</span>
            </div>
            <div className="divide-y divide-gray-50">
              {bookings.slice(0, 8).map((b) => (
                <div key={b.id} className="flex items-center justify-between px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-gray-400">{b.booking_number}</span>
                      <StatusBadge status={b.status} size="xs" />
                    </div>
                    <p className="mt-0.5 truncate text-sm text-ink-950">
                      {b.customer_name} · {b.pickup_address} → {b.dropoff_address}
                    </p>
                  </div>
                  <div className="ml-4 shrink-0 text-right">
                    <p className="font-display font-bold text-ink-950">{money(b.final_fare ?? b.estimated_fare)}</p>
                    <p className="text-xs text-gray-400">{timeAgo(b.created_at)}</p>
                  </div>
                </div>
              ))}
              {bookings.length === 0 && (
                <p className="py-12 text-center text-sm text-gray-400">No bookings yet</p>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
