"use client";

import HelpLink from "@/components/docs/HelpLink";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

interface Req {
  id: string;
  created_at: string;
  status: string;
  paid: boolean;
  package?: string;
  details?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  backup_date?: string | null;
  note?: string | null;
  companies: { name: string; slug: string } | null;
}

/** Companies asking for paid help: setup packages and data restores. */
export default function RequestsPage() {
  const [data, setData] = useState<{ setup: Req[]; restore: Req[] } | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/master/requests").then((r) => r.json()).catch(() => null);
    if (res?.ok) setData(res);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const update = async (kind: string, id: string, patch: Record<string, unknown>) => {
    await fetch("/api/master/requests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, ...patch }) });
    load();
  };
  if (!data) return <Loader2 className="h-6 w-6 animate-spin text-brand-500" />;


  return (
    <div className="space-y-5">
      <h1 className="flex items-center gap-3 font-display text-2xl font-bold text-ink-950">Requests <HelpLink to="master-dashboard#requests" /></h1>
      <List kind="setup" rows={data.setup} update={update} />
      <List kind="restore" rows={data.restore} update={update} />
    </div>
  );
}

function List({
  kind,
  rows,
  update,
}: {
  kind: "setup" | "restore";
  rows: Req[];
  update: (kind: string, id: string, patch: Record<string, unknown>) => void;
}) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white">
      <h2 className="border-b border-gray-100 px-5 py-3 font-semibold text-ink-950">{kind === "setup" ? "Setup help" : "Restore requests"}</h2>
      {rows.length === 0 && <p className="p-5 text-sm text-gray-500">None yet.</p>}
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-50 px-5 py-4 text-sm last:border-0">
          <div className="min-w-0">
            <p className="font-medium text-ink-950">
              {r.companies?.name ?? "—"} · {kind === "setup" ? r.package : `restore to ${r.backup_date ?? "?"}`}
            </p>
            <p className="text-gray-500">
              {new Date(r.created_at).toLocaleString("en-GB")}
              {r.contact_email ? ` · ${r.contact_name ?? ""} <${r.contact_email}>` : ""}
            </p>
            {(r.details || r.note) && <p className="mt-1 whitespace-pre-wrap text-gray-700">{r.details ?? r.note}</p>}
            {kind === "restore" && <p className="mt-1 text-xs text-gray-500">Restore it from Companies → {r.companies?.name} → Backups.</p>}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={r.paid} onChange={(e) => update(kind, r.id, { paid: e.target.checked })} /> Paid
            </label>
            <select value={r.status} onChange={(e) => update(kind, r.id, { status: e.target.value })} className="rounded-lg border border-gray-200 px-2 py-1 text-xs">
              {["new", "in_progress", "done", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      ))}
    </section>
  );
}
