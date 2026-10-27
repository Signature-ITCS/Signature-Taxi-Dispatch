"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, MessageCircle, Flag, ShieldCheck, CircleDot, Info } from "lucide-react";

interface P {
  id: string;
  full_name: string;
  kind: "driver" | "operator";
  council: string;
  badge_number: string;
  badge_expires: string;
  vehicle_type: string | null;
  vehicle: string | null;
  vehicle_seats: number | null;
  plate_number: string | null;
  vehicle_licence_number: string | null;
  vehicle_licence_expires: string | null;
  operator_licence_number: string | null;
  operator_council: string | null;
  operator_licence_expires: string | null;
  areas: string;
  about: string | null;
  available: boolean;
  available_changed_at: string | null;
}

const day = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

/**
 * Partner network: licensed independent drivers and operators who can cover
 * a job. Private to signed-in office staff. Numbers are shown one at a time,
 * on WhatsApp, and every request is logged.
 */
export default function NetworkPage() {
  const [rows, setRows] = useState<P[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [council, setCouncil] = useState("");
  const [type, setType] = useState("");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [onlyOperators, setOnlyOperators] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reporting, setReporting] = useState<P | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/network")
      .then((r) => r.json())
      .then((d) => (d?.ok ? setRows(d.partners) : setError("Couldn't load the partner network.")))
      .catch(() => setError("Couldn't load the partner network."));
  }, []);

  const councils = useMemo(() => [...new Set((rows ?? []).map((r) => r.council))].sort(), [rows]);
  const types = useMemo(() => [...new Set((rows ?? []).map((r) => r.vehicle_type).filter(Boolean) as string[])].sort(), [rows]);
  const shown = (rows ?? []).filter((r) => {
    if (council && r.council !== council && r.operator_council !== council) return false;
    if (type && r.vehicle_type !== type) return false;
    if (onlyAvailable && !r.available) return false;
    if (onlyOperators && r.kind !== "operator") return false;
    const s = q.trim().toLowerCase();
    return !s || `${r.full_name} ${r.areas} ${r.vehicle ?? ""} ${r.council}`.toLowerCase().includes(s);
  });

  const contact = async (p: P) => {
    setBusy(p.id);
    // Open the window first (pop-up blockers), then point it at WhatsApp.
    const w = window.open("about:blank", "_blank");
    const d = await fetch("/api/network", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "contact", partner_id: p.id }) })
      .then((r) => r.json())
      .catch(() => null);
    setBusy(null);
    if (d?.ok && d.whatsapp) {
      if (w) w.location.replace(d.whatsapp);
      else window.location.assign(d.whatsapp);
      setMsg(`${p.full_name}'s number: ${d.phone}`);
    } else {
      w?.close();
      setMsg(d?.error === "rate_limited" ? "Too many contacts in an hour — try again later." : "Couldn't get their number.");
    }
  };

  const sendReport = async () => {
    if (!reporting) return;
    setBusy("report");
    const d = await fetch("/api/network", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "report", partner_id: reporting.id, reason }) })
      .then((r) => r.json())
      .catch(() => null);
    setBusy(null);
    if (d?.ok) {
      setReporting(null);
      setReason("");
      setMsg("Thanks — the report has been sent to the platform team.");
    } else setMsg(d?.error === "reason_needed" ? "Please describe what happened." : "Couldn't send the report.");
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink-950">Partner network</h1>
        <p className="text-sm text-gray-500">Licensed independent drivers and operators who can cover a job. Contact them on WhatsApp.</p>
      </div>

      <p className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Licensing rules: give jobs directly only to drivers licensed by <strong>your own licensing authority</strong>. For other
          areas, pass the booking to a <strong>licensed operator</strong> (marked “Operator licence”). You are responsible for checking
          licences before using a partner.
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, area, vehicle" className="w-44 outline-none" />
        </label>
        <select value={council} onChange={(e) => setCouncil(e.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2">
          <option value="">All licensing councils</option>
          {councils.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2">
          <option value="">Any vehicle</option>
          {types.map((t) => <option key={t}>{t}</option>)}
        </select>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} className="accent-brand-600" /> Available now</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={onlyOperators} onChange={(e) => setOnlyOperators(e.target.checked)} className="accent-brand-600" /> Operator licence</label>
      </div>

      {msg && <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">{msg}</p>}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!rows && !error && <Loader2 className="h-6 w-6 animate-spin text-brand-500" />}
      {rows && shown.length === 0 && <p className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-500">No partners match.</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        {shown.map((p) => (
          <div key={p.id} className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-ink-950">{p.full_name}</p>
                <p className="text-gray-500">{p.areas}</p>
              </div>
              <span className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${p.available ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                <CircleDot className="h-3 w-3" /> {p.available ? "Available now" : "Not available"}
              </span>
            </div>
            <div className="grid gap-1 text-gray-700">
              <p><strong>Licensed by:</strong> {p.council} · badge {p.badge_number} (to {day(p.badge_expires)})</p>
              {p.kind === "operator" && (
                <p className="flex items-center gap-1 text-brand-700"><ShieldCheck className="h-4 w-4" /> Operator licence {p.operator_licence_number} — {p.operator_council} (to {day(p.operator_licence_expires)})</p>
              )}
              <p><strong>Vehicle:</strong> {[p.vehicle_type, p.vehicle, p.vehicle_seats ? `${p.vehicle_seats} seats` : null, p.plate_number].filter(Boolean).join(" · ") || "—"}</p>
              {p.vehicle_licence_number && <p><strong>Vehicle licence:</strong> {p.vehicle_licence_number} (to {day(p.vehicle_licence_expires)})</p>}
              {p.about && <p className="text-gray-500">{p.about}</p>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => contact(p)} disabled={!!busy} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 font-semibold text-white disabled:opacity-60">
                {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />} WhatsApp
              </button>
              <button onClick={() => { setReporting(p); setReason(""); }} className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-gray-600">
                <Flag className="h-4 w-4" /> Report
              </button>
            </div>
          </div>
        ))}
      </div>

      {reporting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setReporting(null)}>
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 text-sm" onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold text-ink-950">Report {reporting.full_name}</p>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="What happened?" className="w-full rounded-xl border border-gray-200 p-3" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setReporting(null)} className="rounded-xl border border-gray-200 px-3 py-2">Cancel</button>
              <button onClick={sendReport} disabled={busy === "report"} className="rounded-xl bg-red-600 px-3 py-2 font-semibold text-white disabled:opacity-60">Send report</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
