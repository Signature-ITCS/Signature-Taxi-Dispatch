"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

interface Entry {
  id: string;
  created_at: string;
  action: string;
  actor_email: string | null;
  detail: unknown;
  companies: { name: string } | null;
}

/** Every sensitive action on the platform: companies created or changed, keys saved, restores. */
export default function AuditPage() {
  const [rows, setRows] = useState<Entry[] | null>(null);
  useEffect(() => {
    fetch("/api/master/audit").then((r) => r.json()).then((d) => d?.ok && setRows(d.entries)).catch(() => null);
  }, []);
  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold text-ink-950">Audit log</h1>
      {!rows ? (
        <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">What</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Who</th>
                <th className="px-4 py-3">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-50 align-top">
                  <td className="whitespace-nowrap px-4 py-2 text-gray-500">{new Date(r.created_at).toLocaleString("en-GB")}</td>
                  <td className="px-4 py-2 font-medium text-ink-950">{r.action.replace(/_/g, " ")}</td>
                  <td className="px-4 py-2">{r.companies?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-gray-600">{r.actor_email ?? "system"}</td>
                  <td className="max-w-xs truncate px-4 py-2 font-mono text-xs text-gray-500" title={JSON.stringify(r.detail)}>
                    {r.detail ? JSON.stringify(r.detail) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
