"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Download, History, ShieldCheck, DatabaseBackup, Lock } from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import { useBrand } from "@/components/BrandProvider";
import { dateTime } from "@/lib/format";

interface Backup {
  id: string;
  created_at: string;
  size_bytes: number | null;
  row_count: number | null;
}

/** Admin → Backups: nightly copies of this company's data; download and restore (plan feature). */
export default function BackupsPage() {
  const brand = useBrand();
  const [loading, setLoading] = useState(true);
  const [included, setIncluded] = useState(false);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const [confirm, setConfirm] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/backups").then((r) => r.json()).catch(() => null);
    setLoading(false);
    if (res?.ok) {
      setIncluded(res.included);
      setBackups(res.backups);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const backupNow = async () => {
    setBusy("now");
    setMsg(null);
    const res = await fetch("/api/admin/backups", { method: "POST" }).then((r) => r.json()).catch(() => null);
    setBusy(null);
    setMsg(res?.ok ? { ok: true, text: "Backup taken." } : { ok: false, text: res?.error === "rate_limited" ? "You've taken several backups this hour — try later." : "The backup failed. Try again." });
    load();
  };

  const restore = async () => {
    if (!restoring) return;
    setBusy("restore");
    setMsg(null);
    const res = await fetch(`/api/admin/backups/${restoring.id}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm }),
    }).then((r) => r.json()).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      setMsg({ ok: true, text: `Restored to ${dateTime(restoring.created_at)}. A backup of how things were just before was taken first.` });
      setRestoring(null);
      setConfirm("");
      load();
    } else {
      setMsg({ ok: false, text: res?.error === "confirm_mismatch" ? "Type the company name exactly to confirm." : "The restore failed — nothing was changed." });
    }
  };

  return (
    <div>
      <PageHeader help="backups" title="Backups" subtitle="Your company's data is backed up every night and kept for 30 days." />

      {msg && <p className={`mb-4 rounded-xl p-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}

      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
      ) : !included ? (
        <div className="rounded-2xl border border-gray-100 bg-white p-6">
          <p className="flex items-center gap-2 font-semibold text-ink-950">
            <Lock className="h-5 w-5 text-gray-400" /> Downloads and restore aren&apos;t included in your plan
          </p>
          <p className="mt-2 text-sm text-gray-600">
            Your data is still backed up every night. If you ever need it put back to an earlier day, we can do it for you —
            request it on the Plan &amp; billing page, or upgrade your plan to download and restore backups yourself.
          </p>
          <Link href="/account" className="mt-4 inline-block rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
            Plan &amp; billing
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              onClick={backupNow}
              disabled={!!busy}
              className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy === "now" ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />} Back up now
            </button>
            <p className="flex items-center gap-1.5 text-xs text-gray-500">
              <ShieldCheck className="h-4 w-4" /> Only {brand.name}&apos;s data — restoring never affects anyone else.
            </p>
          </div>
          <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-100 bg-white">
            {backups.length === 0 && <p className="p-5 text-sm text-gray-500">The first nightly backup will appear here tomorrow.</p>}
            {backups.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium text-ink-950">{dateTime(b.created_at)}</p>
                  <p className="text-xs text-gray-500">
                    {(b.row_count ?? 0).toLocaleString("en-GB")} records · {Math.max(1, Math.round((b.size_bytes ?? 0) / 1024))} KB
                  </p>
                </div>
                <div className="flex gap-2">
                  <a href={`/api/admin/backups/${b.id}`} className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-sm text-ink-950">
                    <Download className="h-4 w-4" /> Download
                  </a>
                  <button
                    onClick={() => {
                      setRestoring(b);
                      setConfirm("");
                    }}
                    className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-sm text-ink-950"
                  >
                    <History className="h-4 w-4" /> Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {restoring && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <h2 className="font-display text-lg font-bold text-ink-950">Restore to {dateTime(restoring.created_at)}?</h2>
            <p className="mt-2 text-sm text-gray-600">
              All bookings, customers, drivers, prices and settings go back to how they were then. Anything added since is
              removed. Logins stay as they are now. Money already taken and messages already sent can&apos;t be undone. A backup
              of how things are now is taken first.
            </p>
            <p className="mt-3 text-sm text-gray-700">
              Type <b>{brand.name}</b> to confirm:
            </p>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setRestoring(null)} className="rounded-xl px-4 py-2 text-sm text-gray-600">
                ✕ Cancel
              </button>
              <button
                onClick={restore}
                disabled={busy === "restore" || confirm.trim().toLowerCase() !== brand.name.trim().toLowerCase()}
                className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy === "restore" && <Loader2 className="h-4 w-4 animate-spin" />} Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
