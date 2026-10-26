"use client";

import Link from "next/link";
import HelpLink from "@/components/docs/HelpLink";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Plus, X, ExternalLink, Mail, History, Trash2, DatabaseBackup } from "lucide-react";

interface Plan {
  id: string;
  name: string;
}
interface Usage {
  drivers: number;
  staff: number;
  bookings_this_month: number;
  max_drivers: number | null;
  max_staff: number | null;
  max_bookings_month: number | null;
}
interface Company {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_id: string | null;
  owner_email: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  owner_phone: string | null;
  billing_paused: boolean;
  custom_domain: string | null;
  notes: string | null;
  created_at: string;
  plans: { name: string } | null;
  usage: Usage | null;
}

const STATUS_TONE: Record<string, string> = {
  trialing: "bg-brand-50 text-brand-700",
  active: "bg-emerald-50 text-emerald-700",
  past_due: "bg-amber-50 text-amber-800",
  suspended: "bg-red-50 text-red-700",
  cancelled: "bg-gray-100 text-gray-600",
};
const ERRORS: Record<string, string> = {
  email_in_use: "That email already has a login.",
  invalid_details: "Fill in the company name and a valid owner email.",
  unknown_plan: "Choose a plan.",
  confirm_mismatch: "Type the company name exactly to confirm.",
  no_owner_login: "The owner has no login to send it to.",
};

export default function CompaniesPage() {
  return (
    <Suspense>
      <Companies />
    </Suspense>
  );
}

function Companies() {
  const params = useSearchParams();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [open, setOpen] = useState<Company | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([
      fetch("/api/master/companies").then((r) => r.json()).catch(() => null),
      fetch("/api/master/plans").then((r) => r.json()).catch(() => null),
    ]);
    if (c?.ok) setCompanies(c.companies);
    if (p?.ok) setPlans(p.plans);
    // ?open=<company id> (links from Billing) opens that company straight away.
    const openId = params.get("open");
    if (c?.ok && openId) setOpen((cur) => cur ?? (c.companies as Company[]).find((x) => x.id === openId) ?? null);
  }, [params]);
  useEffect(() => {
    load();
  }, [load]);

  const shown = (companies ?? []).filter((c) =>
    [c.name, c.slug, c.owner_email ?? ""].some((x) => x.toLowerCase().includes(q.trim().toLowerCase()))
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-3 font-display text-2xl font-bold text-ink-950">Companies <HelpLink to="master-dashboard#companies" /></h1>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          <button onClick={() => setCreating(true)} className="flex items-center gap-1 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
            <Plus className="h-4 w-4" /> Create company
          </button>
        </div>
      </div>

      {!companies ? (
        <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Drivers</th>
                <th className="px-4 py-3">Office</th>
                <th className="px-4 py-3">Bookings (month)</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">No companies yet.</td>
                </tr>
              )}
              {shown.map((c) => (
                <tr key={c.id} onClick={() => setOpen(c)} className="cursor-pointer border-t border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink-950">{c.name}</p>
                    <p className="text-xs text-gray-500">{c.owner_email}</p>
                  </td>
                  <td className="px-4 py-3">{c.plans?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[c.status] ?? ""}`}>{c.status}</span>
                  </td>
                  <td className="px-4 py-3">{fmt(c.usage?.drivers, c.usage?.max_drivers)}</td>
                  <td className="px-4 py-3">{fmt(c.usage?.staff, c.usage?.max_staff)}</td>
                  <td className="px-4 py-3">{fmt(c.usage?.bookings_this_month, c.usage?.max_bookings_month)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <CreateCompany plans={plans} onClose={() => setCreating(false)} onDone={load} />}
      {open && <CompanyPanel company={open} plans={plans} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}

const fmt = (n?: number | null, max?: number | null) => `${n ?? 0}${max != null ? ` / ${max}` : ""}`;

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-xl rounded-2xl bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink-950">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Input({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-gray-700">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 outline-none focus:border-brand-500" />
    </label>
  );
}

function CreateCompany({ plans, onClose, onDone }: { plans: Plan[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ company_name: "", owner_name: "", owner_email: "", owner_phone: "", plan_id: plans[0]?.id ?? "", status: "active", trial_days: "14" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async () => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/master/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, plan_id: f.plan_id || plans[0]?.id }),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setMsg({ ok: true, text: res.emailed ? "Created. The owner has been emailed a link to choose their password." : "Created — but the welcome email could not be sent. Check the platform's email settings, then use “Re-send welcome email”." });
      onDone();
    } else setMsg({ ok: false, text: ERRORS[res?.error] ?? "Couldn't create the company." });
  };
  return (
    <Modal title="Create company" onClose={onClose}>
      <div className="space-y-3">
        <Input label="Company name" value={f.company_name} onChange={(v) => setF({ ...f, company_name: v })} placeholder="City Cars Ltd" />
        <Input label="Owner's name" value={f.owner_name} onChange={(v) => setF({ ...f, owner_name: v })} />
        <Input label="Owner's email (their login)" type="email" value={f.owner_email} onChange={(v) => setF({ ...f, owner_email: v })} />
        <Input label="Owner's mobile / WhatsApp (for payment links)" value={f.owner_phone} onChange={(v) => setF({ ...f, owner_phone: v })} placeholder="+44 7…" />
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Plan</span>
            <select value={f.plan_id} onChange={(e) => setF({ ...f, plan_id: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2">
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Start as</span>
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2">
              <option value="active">Active (first invoice straight away)</option>
              <option value="trialing">Free trial</option>
            </select>
          </label>
        </div>
        {f.status === "trialing" && <Input label="Trial days" value={f.trial_days} onChange={(v) => setF({ ...f, trial_days: v })} />}
        {msg && <p className={`rounded-xl p-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
        <button onClick={submit} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create and email the owner
        </button>
      </div>
    </Modal>
  );
}

interface BackupRow {
  id: string;
  created_at: string;
  row_count: number | null;
}

function CompanyPanel({ company: c, plans, onClose, onChanged }: { company: Company; plans: Plan[]; onClose: () => void; onChanged: () => void }) {
  const [status, setStatus] = useState(c.status);
  const [planId, setPlanId] = useState(c.plan_id ?? "");
  const [notes, setNotes] = useState(c.notes ?? "");
  const [phone, setPhone] = useState(c.owner_phone ?? "");
  const [paused, setPaused] = useState(!!c.billing_paused);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [backups, setBackups] = useState<BackupRow[] | null>(null);
  const [restoreId, setRestoreId] = useState("");
  const [confirm, setConfirm] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const loadBackups = useCallback(async () => {
    const res = await fetch(`/api/master/companies/${c.id}/backups`).then((r) => r.json()).catch(() => null);
    if (res?.ok) setBackups(res.backups);
  }, [c.id]);
  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  const call = async (key: string, method: string, url: string, body: unknown, okText: string) => {
    setBusy(key);
    setMsg(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .catch(() => null);
    setBusy(null);
    if (res?.ok) {
      setMsg({ ok: true, text: okText });
      onChanged();
      return true;
    }
    setMsg({ ok: false, text: ERRORS[res?.error] ?? "That didn't work." });
    return false;
  };

  return (
    <Modal title={c.name} onClose={onClose}>
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap gap-3 text-gray-600">
          <a href={`/${c.slug}`} target="_blank" className="flex items-center gap-1 text-brand-600">
            /{c.slug} <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <a href={`/${c.slug}/login`} target="_blank" className="flex items-center gap-1 text-brand-600">
            Staff sign-in <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <span>Owner: {c.owner_email}</span>
          <span>Since {new Date(c.created_at).toLocaleDateString("en-GB")}</span>
          <Link href="/master/billing" className="text-brand-600">Invoices →</Link>
        </div>

        {msg && <p className={`rounded-xl p-3 ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="font-medium text-gray-700">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2">
              {["trialing", "active", "past_due", "suspended", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="font-medium text-gray-700">Plan</span>
            <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2">
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="font-medium text-gray-700">Owner&apos;s mobile / WhatsApp</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 7…" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2" />
          </label>
          <label className="flex items-end gap-2 pb-2">
            <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            <span className="text-gray-700">Don&apos;t make invoices for this company (free, or billed some other way)</span>
          </label>
        </div>
        <label className="block">
          <span className="font-medium text-gray-700">Notes (only you see these)</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-gray-200 p-2" />
        </label>
        <p className="text-xs text-gray-500">
          Suspending switches off its booking page, dispatch board and driver app at once. Its data is kept. A company with an
          invoice past its due date shows Payment overdue by itself; marking the invoice paid in Billing makes it Active again.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => call("save", "PATCH", `/api/master/companies/${c.id}`, { status, plan_id: planId, notes, owner_phone: phone, billing_paused: paused }, "Saved.")}
            disabled={!!busy}
            className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
          </button>
          <button
            onClick={() => call("welcome", "PATCH", `/api/master/companies/${c.id}`, { resend_welcome: true }, "Welcome email sent.")}
            disabled={!!busy}
            className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 font-semibold text-ink-950 disabled:opacity-60"
          >
            {busy === "welcome" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Re-send welcome email
          </button>
        </div>

        <section className="rounded-xl border border-gray-100 p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold text-ink-950">
              <History className="h-4 w-4" /> Backups
            </h3>
            <button
              onClick={async () => {
                if (await call("backup", "POST", `/api/master/companies/${c.id}/backups`, { action: "backup" }, "Backup taken.")) loadBackups();
              }}
              disabled={!!busy}
              className="flex items-center gap-1 text-xs font-semibold text-brand-600"
            >
              {busy === "backup" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DatabaseBackup className="h-3.5 w-3.5" />} Back up now
            </button>
          </div>
          {!backups ? (
            <Loader2 className="mt-2 h-4 w-4 animate-spin text-gray-400" />
          ) : backups.length === 0 ? (
            <p className="mt-2 text-gray-500">No backups yet (the first runs tonight).</p>
          ) : (
            <div className="mt-3 space-y-2">
              <select value={restoreId} onChange={(e) => setRestoreId(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2">
                <option value="">Choose a backup to restore…</option>
                {backups.map((b) => (
                  <option key={b.id} value={b.id}>
                    {new Date(b.created_at).toLocaleString("en-GB")} · {b.row_count ?? 0} records
                  </option>
                ))}
              </select>
              {restoreId && (
                <>
                  <p className="text-xs text-gray-600">
                    Puts only this company&apos;s data back to that time (a backup of now is taken first). Type <b>{c.name}</b>:
                  </p>
                  <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2" />
                  <button
                    onClick={() => call("restore", "POST", `/api/master/companies/${c.id}/backups`, { action: "restore", backup_id: restoreId, confirm }, "Restored.")}
                    disabled={!!busy || confirm.trim() !== c.name.trim()}
                    className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
                  >
                    {busy === "restore" && <Loader2 className="h-4 w-4 animate-spin" />} Restore this backup
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-red-100 p-4">
          <h3 className="flex items-center gap-2 font-semibold text-red-700">
            <Trash2 className="h-4 w-4" /> Delete company
          </h3>
          <p className="mt-1 text-xs text-gray-600">
            Removes the company, all its bookings, customers, drivers and settings, and its logins. This can&apos;t be undone.
            Cancel its Stripe subscription first. Type <b>{c.name}</b> to confirm:
          </p>
          <input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2" />
          <button
            onClick={async () => {
              if (await call("delete", "DELETE", `/api/master/companies/${c.id}`, { confirm: deleteConfirm }, "Deleted.")) onClose();
            }}
            disabled={!!busy || deleteConfirm.trim() !== c.name.trim()}
            className="mt-2 rounded-xl border border-red-200 px-4 py-2 font-semibold text-red-700 disabled:opacity-50"
          >
            Delete permanently
          </button>
        </section>
      </div>
    </Modal>
  );
}
