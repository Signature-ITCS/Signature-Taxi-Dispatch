"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Loader2,
  LogIn,
  UserPlus,
  UserMinus,
  ClipboardList,
  CarFront,
  Banknote,
  Tags,
  RotateCcw,
  Activity,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import PageHeader from "@/components/admin/PageHeader";
import Pagination, { usePageState } from "@/components/dashboard/Pagination";
import { timeAgo, dateTime, cn } from "@/lib/format";

interface Log {
  id: string;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  description: string;
  created_at: string;
}

function iconFor(action: string) {
  if (action === "login") return { Icon: LogIn, tone: "bg-blue-50 text-blue-600" };
  if (action.startsWith("dispatcher_added") || action.includes("added")) return { Icon: UserPlus, tone: "bg-brand-50 text-brand-600" };
  if (action.includes("removed") || action.includes("delete")) return { Icon: UserMinus, tone: "bg-red-50 text-red-600" };
  if (action.startsWith("booking")) return { Icon: ClipboardList, tone: "bg-brand-50 text-brand-600" };
  if (action.startsWith("driver")) return { Icon: CarFront, tone: "bg-violet-50 text-violet-600" };
  if (action.startsWith("cash")) return { Icon: Banknote, tone: "bg-green-50 text-green-600" };
  if (action.startsWith("pricing")) return { Icon: Tags, tone: "bg-amber-50 text-amber-600" };
  if (action.startsWith("refund")) return { Icon: RotateCcw, tone: "bg-red-50 text-red-600" };
  return { Icon: Activity, tone: "bg-gray-100 text-gray-500" };
}

export default function LogsPage() {
  const supabase = createClient();
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  // Paged in the database — the full history stays reachable.
  const { page, setPage, pageSize, setPageSize } = usePageState("activity-logs", 50);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    const { data, count } = await supabase
      .from("activity_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    setLogs((data as Log[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [supabase, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  // New activity only matters on the first page.
  useEffect(() => {
    if (page !== 1) return;
    const ch = supabase
      .channel("activity_logs")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_logs" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase, page, load]);

  return (
    <div>
      <PageHeader title="Activity Logs" subtitle="Everything happening across the system, newest first" />

      <div className="px-5 pb-10 md:px-8">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-brand-600" />
          </div>
        ) : logs.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-400">No activity yet.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            {logs.map((l, i) => {
              const { Icon, tone } = iconFor(l.action);
              return (
                <motion.div
                  key={l.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.015, 0.3) }}
                  className="flex items-start gap-3 border-b border-gray-50 px-5 py-3.5 last:border-0"
                >
                  <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tone)}>
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink-950">{l.description}</p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {l.actor_name ? (
                        <>
                          <span className="font-medium text-gray-500">{l.actor_name}</span>
                          {l.actor_role ? ` · ${l.actor_role}` : ""} ·{" "}
                        </>
                      ) : (
                        <span className="text-gray-400">System / customer · </span>
                      )}
                      <span title={dateTime(l.created_at)}>{timeAgo(l.created_at)}</span>
                    </p>
                  </div>
                </motion.div>
              );
            })}
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
    </div>
  );
}
