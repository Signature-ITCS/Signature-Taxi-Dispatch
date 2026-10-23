"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, Check } from "lucide-react";

interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_monthly: number;
  max_drivers: number | null;
  max_staff: number | null;
  max_bookings_month: number | null;
  backups_included: boolean;
  features: string[];
  trial_days: number;
  is_public: boolean;
  is_active: boolean;
  sort_order: number;
  stripe_price_id: string | null;
}

const ERRORS: Record<string, string> = {
  stripe_not_configured: "Add your Stripe secret key in Platform settings first.",
  stripe_error: "Stripe refused it — check the key in Platform settings.",
  code_in_use: "Another plan already uses that code.",
  invalid_code: "Code: 2–30 lowercase letters, digits or dashes.",
  invalid_price: "Enter a valid monthly price.",
};

/** Subscription plans: prices, limits, features — and syncing them to Stripe. */
export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/master/plans").then((r) => r.json()).catch(() => null);
    if (res?.ok) setPlans(res.plans);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const addPlan = async () => {
    const n = (plans?.length ?? 0) + 1;
    const res = await fetch("/api/master/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: `plan-${n}`, name: `New plan ${n}`, price_monthly: 0, is_public: false, sort_order: n }),
    }).then((r) => r.json()).catch(() => null);
    if (!res?.ok) setMsg({ ok: false, text: ERRORS[res?.error] ?? "Couldn't add the plan." });
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-950">Plans</h1>
          <p className="text-sm text-gray-500">Limits apply instantly. A plan is sold on the website once it is public, active and synced to Stripe.</p>
        </div>
        <button onClick={addPlan} className="flex items-center gap-1 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
          <Plus className="h-4 w-4" /> Add plan
        </button>
      </div>
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
      {!plans ? (
        <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {plans.map((p) => <PlanCard key={p.id} plan={p} onChanged={load} setMsg={setMsg} />)}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan, onChanged, setMsg }: { plan: Plan; onChanged: () => void; setMsg: (m: { ok: boolean; text: string } | null) => void }) {
  const [p, setP] = useState({
    ...plan,
    features: plan.features.join("\n"),
    max_drivers: plan.max_drivers?.toString() ?? "",
    max_staff: plan.max_staff?.toString() ?? "",
    max_bookings_month: plan.max_bookings_month?.toString() ?? "",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const send = async (key: string, body: unknown, okText: string) => {
    setBusy(key);
    setMsg(null);
    const res = await fetch(`/api/master/plans/${plan.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .catch(() => null);
    setBusy(null);
    setMsg(res?.ok ? { ok: true, text: okText } : { ok: false, text: ERRORS[res?.error] ?? "Couldn't save the plan." });
    if (res?.ok) onChanged();
  };
  const num = (label: string, k: "price_monthly" | "max_drivers" | "max_staff" | "max_bookings_month" | "trial_days", hint?: string) => (
    <label className="block text-sm">
      <span className="font-medium text-gray-700">{label}</span>
      <input
        value={String(p[k] ?? "")}
        onChange={(e) => setP({ ...p, [k]: e.target.value })}
        placeholder={hint}
        className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2"
      />
    </label>
  );
  return (
    <div className="space-y-3 rounded-2xl border border-gray-100 bg-white p-5">
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="font-medium text-gray-700">Name</span>
          <input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2" />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-gray-700">Code</span>
          <input value={p.code} onChange={(e) => setP({ ...p, code: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono" />
        </label>
        {num("£ per month", "price_monthly")}
        {num("Free trial days", "trial_days")}
        {num("Drivers", "max_drivers", "empty = unlimited")}
        {num("Office users", "max_staff", "empty = unlimited")}
        {num("Bookings a month", "max_bookings_month", "empty = unlimited")}
      </div>
      <label className="block text-sm">
        <span className="font-medium text-gray-700">Short description</span>
        <input value={p.description ?? ""} onChange={(e) => setP({ ...p, description: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2" />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-gray-700">Feature lines on the pricing page (one per line)</span>
        <textarea value={p.features} onChange={(e) => setP({ ...p, features: e.target.value })} rows={3} className="mt-1 w-full rounded-xl border border-gray-200 p-2" />
      </label>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.backups_included} onChange={(e) => setP({ ...p, backups_included: e.target.checked })} /> Self-service backups</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.is_public} onChange={(e) => setP({ ...p, is_public: e.target.checked })} /> On the pricing page</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={p.is_active} onChange={(e) => setP({ ...p, is_active: e.target.checked })} /> Active</label>
      </div>
      <p className="text-xs text-gray-500">
        Stripe: {plan.stripe_price_id ? <span className="font-mono">{plan.stripe_price_id}</span> : "not synced — can't be bought on the website yet"}
      </p>
      <div className="flex gap-2">
        <button
          onClick={() =>
            send("save", {
              name: p.name, code: p.code, description: p.description, price_monthly: p.price_monthly, trial_days: p.trial_days,
              max_drivers: p.max_drivers, max_staff: p.max_staff, max_bookings_month: p.max_bookings_month,
              features: p.features, backups_included: p.backups_included, is_public: p.is_public, is_active: p.is_active,
            }, "Plan saved. Sync to Stripe if you changed the price.")
          }
          disabled={!!busy}
          className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
        </button>
        <button
          onClick={() => send("sync", { sync: true }, "Synced to Stripe.")}
          disabled={!!busy}
          className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-ink-950 disabled:opacity-60"
        >
          {busy === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync to Stripe
        </button>
      </div>
    </div>
  );
}
