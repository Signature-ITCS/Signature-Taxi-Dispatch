"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, PoundSterling, TrendingUp, Globe, Star, Activity } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import PageHeader from "@/components/admin/PageHeader";
import { money, cn } from "@/lib/format";
import { STATUS_META } from "@/lib/constants";
import type { Booking, BookingStatus, Driver, Website } from "@/lib/types";

interface RevenueStats {
  total_revenue: number;
  completed_count: number;
  total_bookings: number;
  avg_fare: number;
  series: { d: string; revenue: number; count: number }[];
}

export default function AnalyticsPage() {
  const supabase = createClient();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [sites, setSites] = useState<Website[]>([]);
  const [stats, setStats] = useState<RevenueStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: bk }, { data: dr }, { data: ws }, { data: rs }] = await Promise.all([
        supabase.from("bookings").select("*").order("created_at", { ascending: false }).limit(1000),
        supabase.from("drivers").select("*"),
        supabase.from("websites").select("*"),
        supabase.rpc("revenue_stats", { p_days: 7 }),
      ]);
      setBookings((bk as Booking[]) ?? []);
      setDrivers((dr as Driver[]) ?? []);
      setSites((ws as Website[]) ?? []);
      if (rs?.ok) setStats(rs as RevenueStats);
      setLoading(false);
    })();
  }, [supabase]);

  // Revenue & bookings totals come from the server-side aggregate (all rows,
  // bucketed by completed_at in the company timezone).
  const days = useMemo(
    () =>
      (stats?.series ?? []).map((s) => ({
        key: s.d,
        label: new Date(s.d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" }),
        revenue: Number(s.revenue) || 0,
        count: s.count,
      })),
    [stats]
  );

  const maxRev = Math.max(1, ...days.map((d) => d.revenue));
  const totalRevenue = stats?.total_revenue ?? 0;
  const avgFare = stats?.avg_fare ?? 0;
  const totalBookings = stats?.total_bookings ?? bookings.length;

  const byWebsite = useMemo(() => {
    const map = new Map<string, number>();
    bookings.forEach((b) => map.set(b.website_id ?? "other", (map.get(b.website_id ?? "other") ?? 0) + 1));
    const rows = sites.map((s) => ({ name: s.name, color: s.color, count: map.get(s.id) ?? 0 }));
    const direct = map.get("other") ?? 0;
    if (direct > 0) rows.push({ name: "Direct / other", color: "#9ca3af", count: direct });
    return rows.sort((a, b) => b.count - a.count);
  }, [bookings, sites]);
  const maxSite = Math.max(1, ...byWebsite.map((s) => s.count));

  const statusDist = useMemo(() => {
    const map = new Map<BookingStatus, number>();
    bookings.forEach((b) => map.set(b.status, (map.get(b.status) ?? 0) + 1));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [bookings]);

  const topDrivers = useMemo(
    () => [...drivers].sort((a, b) => b.total_trips - a.total_trips).slice(0, 5),
    [drivers]
  );
  const maxTrips = Math.max(1, ...topDrivers.map((d) => d.total_trips));

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-brand-600" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Insights across your operation" />
      <div className="space-y-6 px-5 pb-10 md:px-8">
        {/* Top stats */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Kpi icon={PoundSterling} tone="emerald" label="Total revenue" value={money(totalRevenue)} />
          <Kpi icon={TrendingUp} tone="blue" label="Avg fare" value={money(avgFare)} />
          <Kpi icon={Activity} tone="violet" label="Total bookings" value={String(totalBookings)} />
        </div>

        {/* Revenue chart */}
        <Card title="Revenue — last 7 days" icon={TrendingUp}>
          <div className="flex items-end justify-between gap-3 pt-4" style={{ height: 200 }}>
            {days.map((d, i) => (
              <div key={d.key} className="flex flex-1 flex-col items-center justify-end gap-2">
                <span className="text-xs font-semibold text-ink-950">
                  {d.revenue > 0 ? money(d.revenue) : ""}
                </span>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${(d.revenue / maxRev) * 100}%` }}
                  transition={{ delay: i * 0.06, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  className="w-full rounded-t-lg bg-gradient-to-t from-brand-400 to-brand-500"
                  style={{ minHeight: d.revenue > 0 ? 4 : 0 }}
                />
                <span className="text-xs text-gray-400">{d.label}</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* By website */}
          <Card title="Bookings by website" icon={Globe}>
            <div className="space-y-3 pt-2">
              {byWebsite.length === 0 && <Empty />}
              {byWebsite.map((s) => (
                <div key={s.name}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-ink-950">{s.name}</span>
                    <span className="text-gray-400">{s.count}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(s.count / maxSite) * 100}%` }}
                      transition={{ duration: 0.5 }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Status distribution */}
          <Card title="Status distribution" icon={Activity}>
            <div className="space-y-2.5 pt-2">
              {statusDist.length === 0 && <Empty />}
              {statusDist.map(([status, count]) => {
                const m = STATUS_META[status];
                return (
                  <div key={status} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm">
                      <span className={cn("h-2.5 w-2.5 rounded-full", m.dot)} />
                      <span className="text-ink-950">{m.label}</span>
                    </span>
                    <span className="text-sm font-semibold text-gray-500">{count}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Top drivers */}
        <Card title="Top drivers" icon={Star}>
          <div className="space-y-3 pt-2">
            {topDrivers.length === 0 && <Empty />}
            {topDrivers.map((d, i) => (
              <div key={d.id} className="flex items-center gap-3">
                <span className="w-5 text-sm font-bold text-gray-300">{i + 1}</span>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                  {d.full_name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-ink-950">{d.full_name}</span>
                    <span className="flex items-center gap-2 text-xs text-gray-400">
                      <span className="flex items-center gap-0.5">
                        <Star className="h-3 w-3 fill-brand-400 text-brand-400" /> {Number(d.rating).toFixed(1)}
                      </span>
                      {d.total_trips} trips
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(d.total_trips / maxTrips) * 100}%` }}
                      transition={{ duration: 0.5, delay: i * 0.05 }}
                      className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-500"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  tone: "emerald" | "blue" | "violet";
}) {
  const tones = {
    emerald: "bg-brand-50 text-brand-600",
    blue: "bg-blue-50 text-blue-600",
    violet: "bg-violet-50 text-violet-600",
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
    >
      <div className={cn("mb-3 flex h-10 w-10 items-center justify-center rounded-xl", tones[tone])}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="font-display text-2xl font-bold text-ink-950">{value}</p>
      <p className="text-sm text-gray-500">{label}</p>
    </motion.div>
  );
}

function Card({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
    >
      <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
        <Icon className="h-4 w-4 text-brand-600" /> {title}
      </h2>
      {children}
    </motion.div>
  );
}

function Empty() {
  return <p className="py-6 text-center text-sm text-gray-400">No data yet</p>;
}
