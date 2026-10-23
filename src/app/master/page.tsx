"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

interface Overview {
  stats: { companies: number; active: number; trialing: number; past_due: number; suspended: number; mrr: number; open_requests: number };
  recent: { id: string; name: string; status: string; created_at: string; plans: { name: string } | null }[];
}

export default function MasterOverview() {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    fetch("/api/master/overview").then((r) => r.json()).then((d) => d?.ok && setData(d)).catch(() => null);
  }, []);
  if (!data) return <Loader2 className="h-6 w-6 animate-spin text-brand-500" />;
  const s = data.stats;
  const tiles: [string, string, string?][] = [
    ["Companies", String(s.companies)],
    ["Monthly income", `£${s.mrr.toLocaleString("en-GB")}`, "active + overdue"],
    ["On free trial", String(s.trialing)],
    ["Payment overdue", String(s.past_due)],
    ["Suspended / cancelled", String(s.suspended)],
    ["Open requests", String(s.open_requests)],
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-ink-950">Overview</h1>
        <Link href="/master/companies?new=1" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
          + Create company
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {tiles.map(([label, value, hint]) => (
          <div key={label} className="rounded-2xl border border-gray-100 bg-white p-4">
            <p className="text-sm text-gray-500">{label}</p>
            <p className="mt-1 font-display text-2xl font-bold text-ink-950">{value}</p>
            {hint && <p className="text-xs text-gray-400">{hint}</p>}
          </div>
        ))}
      </div>
      <section className="rounded-2xl border border-gray-100 bg-white">
        <h2 className="border-b border-gray-100 px-5 py-3 font-semibold text-ink-950">Newest companies</h2>
        {data.recent.length === 0 && <p className="p-5 text-sm text-gray-500">No companies yet.</p>}
        {data.recent.map((c) => (
          <div key={c.id} className="flex items-center justify-between border-b border-gray-50 px-5 py-3 text-sm last:border-0">
            <span className="font-medium text-ink-950">{c.name}</span>
            <span className="text-gray-500">
              {c.plans?.name ?? "—"} · {c.status} · {new Date(c.created_at).toLocaleDateString("en-GB")}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
