"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Check, Ban, RotateCcw, CalendarPlus, Mail, Trash2, Save, ExternalLink } from "lucide-react";

interface Partner {
  id: string;
  user_id: string | null;
  status: "pending" | "active" | "disabled";
  full_name: string;
  email: string;
  phone: string;
  kind: "driver" | "operator";
  council: string;
  badge_number: string;
  badge_expires: string;
  vehicle_type: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_colour: string | null;
  vehicle_seats: number | null;
  plate_number: string | null;
  vehicle_licence_number: string | null;
  vehicle_licence_expires: string | null;
  operator_licence_number: string | null;
  operator_council: string | null;
  operator_licence_expires: string | null;
  areas: string;
  about: string | null;
  owner_notes: string | null;
  paid_until: string | null;
  created_at: string;
  hidden_because: string | null;
  contacts_30d: number;
}
interface Report {
  id: string;
  partner_id: string;
  user_name: string | null;
  reason: string;
  status: string;
  created_at: string;
  companies: { name: string } | null;
}

const TABS = [["pending", "Waiting for approval"], ["listed", "Listed"], ["hidden", "Not listed"], ["all", "All"]] as const;
const ERRORS: Record<string, string> = {
  login_failed: "Couldn't create their login (is the email already used?).",
  approve_first: "Approve them first.",
  confirm_mismatch: "Type their full name exactly to delete.",
  badge_expires_needed: "The badge expiry date is required.",
};
const day = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

/** The partner network: approve drivers, check licences, mark months paid, disable. */
export default function PartnersPage() {
  const [rows, setRows] = useState<Partner[] | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [price, setPrice] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("pending");
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/master/partners").then((r) => r.json()).catch(() => null);
    if (d?.ok) {
      setRows(d.partners);
      setReports(d.reports);
      setPrice(String(d.price));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const post = async (body: Record<string, unknown>, okText: string) => {
    setMsg(null);
    const d = await fetch("/api/master/partners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .catch(() => null);
    if (d?.ok) {
      setMsg({ ok: true, text: typeof okText === "string" ? okText : "Done." });
      await load();
      return d;
    }
    setMsg({ ok: false, text: ERRORS[d?.error] ?? "That didn't work." });
    return null;
  };

  const shown = (rows ?? []).filter((p) =>
    tab === "pending" ? p.status === "pending" : tab === "listed" ? !p.hidden_because : tab === "hidden" ? !!p.hidden_because && p.status !== "pending" : true
  );
  const pending = (rows ?? []).filter((p) => p.status === "pending").length;
  const openReports = reports.filter((r) => r.status === "new");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-950">Partner network</h1>
          <p className="text-sm text-gray-500">
            Independent drivers and operators companies can contact. Listed only when approved, paid up and licences in date.
            Join page: <a href="/partners/join" target="_blank" className="text-brand-600">/partners/join <ExternalLink className="inline h-3 w-3" /></a>
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          Monthly price £
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" className="w-20 rounded-xl border border-gray-200 px-2 py-1.5" />
          <button onClick={() => post({ price }, "Price saved.")} className="rounded-xl border border-gray-200 px-3 py-1.5 font-semibold">Save</button>
        </label>
      </div>

      {msg && <p className={`rounded-xl p-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}

      {openReports.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm">
          <p className="font-semibold text-red-800">{openReports.length} report{openReports.length === 1 ? "" : "s"} to review</p>
          {openReports.map((r) => (
            <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl bg-white p-3">
              <div>
                <p className="font-medium text-ink-950">{rows?.find((p) => p.id === r.partner_id)?.full_name ?? "Partner"} — from {r.user_name} ({r.companies?.name ?? "?"}), {day(r.created_at)}</p>
                <p className="text-gray-600">{r.reason}</p>
              </div>
              <button onClick={() => post({ action: "report_reviewed", report_id: r.id }, "Marked reviewed.")} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold">Mark reviewed</button>
            </div>
          ))}
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-full border px-3 py-1.5 text-sm ${tab === k ? "border-brand-500 bg-brand-50 font-semibold text-brand-700" : "border-gray-200 text-gray-600"}`}>
            {label}{k === "pending" && pending ? ` (${pending})` : ""}
          </button>
        ))}
      </div>

      {!rows && <Loader2 className="h-6 w-6 animate-spin text-brand-500" />}
      {rows && shown.length === 0 && <p className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-500">Nobody here.</p>}

      <div className="space-y-2">
        {shown.map((p) => (
          <PartnerCard key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} post={post} />
        ))}
      </div>
    </div>
  );
}

function PartnerCard({ p, open, onToggle, post }: { p: Partner; open: boolean; onToggle: () => void; post: (b: Record<string, unknown>, t: string) => Promise<unknown> }) {
  const [f, setF] = useState(() => ({
    full_name: p.full_name, phone: p.phone, kind: p.kind, council: p.council, badge_number: p.badge_number, badge_expires: p.badge_expires ?? "",
    vehicle_type: p.vehicle_type ?? "", vehicle_make: p.vehicle_make ?? "", vehicle_model: p.vehicle_model ?? "", vehicle_colour: p.vehicle_colour ?? "",
    vehicle_seats: String(p.vehicle_seats ?? ""), plate_number: p.plate_number ?? "", vehicle_licence_number: p.vehicle_licence_number ?? "",
    vehicle_licence_expires: p.vehicle_licence_expires ?? "", operator_licence_number: p.operator_licence_number ?? "", operator_council: p.operator_council ?? "",
    operator_licence_expires: p.operator_licence_expires ?? "", areas: p.areas, about: p.about ?? "", owner_notes: p.owner_notes ?? "", paid_until: p.paid_until ?? "",
  }));
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, body: Record<string, unknown>, okText: string) => {
    setBusy(key);
    await post({ id: p.id, ...body }, okText);
    setBusy(null);
  };
  const input = (k: keyof typeof f, label: string, type = "text") => (
    <label className="block text-xs text-gray-600">
      {label}
      <input type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-ink-950" />
    </label>
  );
  const badge = p.status === "pending" ? ["Waiting", "bg-orange-100 text-orange-800"] : p.hidden_because ? [`Hidden: ${p.hidden_because}`, "bg-amber-50 text-amber-800"] : ["Listed", "bg-emerald-50 text-emerald-700"];

  return (
    <div className="rounded-2xl border border-gray-100 bg-white">
      <button onClick={onToggle} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-sm">
        <span className="min-w-[12rem] flex-1">
          <span className="font-semibold text-ink-950">{p.full_name}</span>
          <span className="block text-xs text-gray-500">{p.council} · badge {p.badge_number} · {p.areas}</span>
        </span>
        <span className="text-xs text-gray-500">{p.kind === "operator" ? "Operator licence" : "Driver"}</span>
        <span className="text-xs text-gray-500">Paid until {day(p.paid_until)}</span>
        <span className="text-xs text-gray-500">{p.contacts_30d} contacts (30 days)</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge[1]}`}>{badge[0]}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-gray-50 p-4 text-sm">
          <p className="text-gray-600">{p.email} · {p.phone} · applied {day(p.created_at)}</p>
          <div className="flex flex-wrap gap-2">
            {p.status === "pending" && (
              <button onClick={() => run("approve", { action: "approve" }, "Approved — they've been emailed a link to set their password. Mark a month paid to list them.")} disabled={!!busy}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 font-semibold text-white disabled:opacity-60">
                {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve (licences checked)
              </button>
            )}
            <button onClick={() => run("paid", { action: "paid_month" }, "Paid for another month.")} disabled={!!busy} className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 font-semibold">
              <CalendarPlus className="h-4 w-4" /> +1 month paid
            </button>
            {p.status === "active" && (
              <button onClick={() => run("disable", { action: "disable" }, "Disabled — no longer listed.")} disabled={!!busy} className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 font-semibold">
                <Ban className="h-4 w-4" /> Disable
              </button>
            )}
            {p.status === "disabled" && (
              <button onClick={() => run("enable", { action: "enable" }, "Enabled.")} disabled={!!busy} className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 font-semibold">
                <RotateCcw className="h-4 w-4" /> Enable
              </button>
            )}
            {p.user_id && (
              <button onClick={() => run("resend", { action: "resend_login" }, "Sign-in link sent.")} disabled={!!busy} className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 font-semibold">
                <Mail className="h-4 w-4" /> Re-send sign-in link
              </button>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {input("full_name", "Name")}
            {input("phone", "Mobile / WhatsApp")}
            {input("areas", "Areas")}
            {input("council", "Licensing council")}
            {input("badge_number", "Badge number")}
            {input("badge_expires", "Badge expires", "date")}
            {input("vehicle_type", "Vehicle type")}
            {input("vehicle_make", "Make")}
            {input("vehicle_model", "Model")}
            {input("vehicle_colour", "Colour")}
            {input("vehicle_seats", "Seats")}
            {input("plate_number", "Registration")}
            {input("vehicle_licence_number", "Vehicle licence number")}
            {input("vehicle_licence_expires", "Vehicle licence expires", "date")}
            {input("paid_until", "Paid until", "date")}
            <label className="block text-xs text-gray-600">
              Type
              <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "driver" | "operator" })} className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm">
                <option value="driver">Driver</option>
                <option value="operator">Driver with operator licence</option>
              </select>
            </label>
            {f.kind === "operator" && input("operator_licence_number", "Operator licence number")}
            {f.kind === "operator" && input("operator_council", "Operator licence council")}
            {f.kind === "operator" && input("operator_licence_expires", "Operator licence expires", "date")}
          </div>
          {input("about", "About (shown to companies)")}
          <label className="block text-xs text-gray-600">
            Private notes (only you)
            <textarea value={f.owner_notes} onChange={(e) => setF({ ...f, owner_notes: e.target.value })} rows={2} className="mt-0.5 w-full rounded-lg border border-gray-200 p-2 text-sm" />
          </label>
          <div className="flex flex-wrap justify-between gap-2">
            <button onClick={() => run("save", { action: "edit", fields: f }, "Saved.")} disabled={!!busy} className="flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-60">
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save details
            </button>
            <button
              onClick={() => {
                const c = window.prompt(`Type "${p.full_name}" to delete this partner and their login for good.`);
                if (c) run("delete", { action: "delete", confirm: c }, "Deleted.");
              }}
              className="flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 font-semibold text-red-700"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
