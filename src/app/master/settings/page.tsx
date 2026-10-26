"use client";

import HelpLink from "@/components/docs/HelpLink";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, AlertTriangle, Plus, Trash2 } from "lucide-react";
import { SecretInput, useSecretFields, type SecretStatus } from "@/components/SecretInput";

interface Pkg {
  code: string;
  name: string;
  price: number;
  description: string;
}
interface Data {
  platform: { name: string; support_email: string; from_email: string };
  services: { setup_packages: Pkg[]; restore_price: number };
  secrets: Record<string, SecretStatus>;
  encryption_ready: boolean;
  encryption_problem: string | null;
  env_fallbacks: Record<string, boolean>;
}

const ERRORS: Record<string, string> = {
  invalid_support_email: "The support email isn't valid.",
  invalid_from_email: "The sender email isn't valid.",
  invalid_resend_api_key: "That isn't a Resend API key (re_…).",
  encryption_not_configured: "Set SECRETS_ENCRYPTION_KEY in Vercel first, then redeploy.",
};

/** The platform's own name, addresses, paid services and email key (Resend). Subscriptions are billed by hand (Billing). */
export default function PlatformSettingsPage() {
  const [d, setD] = useState<Data | null>(null);
  const [platform, setPlatform] = useState({ name: "", support_email: "", from_email: "" });
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [restorePrice, setRestorePrice] = useState("0");
  // Key fields: never held in state — read once on Save, then wiped.
  const fields = useSecretFields();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/master/settings").then((r) => r.json()).catch(() => null);
    if (!res?.ok) return;
    setD(res);
    setPlatform(res.platform);
    setPackages(res.services.setup_packages);
    setRestorePrice(String(res.services.restore_price));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (key: string, body: unknown) => {
    setBusy(key);
    setMsg(null);
    const res = await fetch("/api/master/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .catch(() => null);
    setBusy(null);
    setMsg(res?.ok ? { ok: true, text: "Saved." } : { ok: false, text: ERRORS[res?.error] ?? "Couldn't save." });
    if (res?.ok) load();
    return !!res?.ok;
  };

  if (!d) return <Loader2 className="h-6 w-6 animate-spin text-brand-500" />;
  const secretRow = (name: string, label: string, placeholder: string) => (
    <SecretInput
      key={name}
      label={label}
      name={name}
      status={d.secrets[name]}
      fields={fields}
      placeholder={d.env_fallbacks[name] && !d.secrets[name]?.set ? `${placeholder} (using the Vercel value until set)` : placeholder}
    />
  );

  return (
    <div className="max-w-3xl space-y-5 pb-16">
      <h1 className="flex items-center gap-3 font-display text-2xl font-bold text-ink-950">Platform settings <HelpLink to="platform-setup#env" /></h1>
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
      {!d.encryption_ready && (
        <p className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {d.encryption_problem ?? "SECRETS_ENCRYPTION_KEY isn't usable."} No keys can be saved (yours or companies&apos;) until it is fixed.
        </p>
      )}

      <section className="space-y-3 rounded-2xl border border-gray-100 bg-white p-5">
        <h2 className="font-semibold text-ink-950">Platform</h2>
        {(["name", "support_email", "from_email"] as const).map((k) => (
          <label key={k} className="block text-sm">
            <span className="font-medium text-gray-700">
              {k === "name" ? "Platform name (home page, emails)" : k === "support_email" ? "Your support email (notifications to you; shown to companies)" : "Send platform emails from (on your Resend-verified domain)"}
            </span>
            <input value={platform[k]} onChange={(e) => setPlatform({ ...platform, [k]: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2" />
          </label>
        ))}
        <button onClick={() => save("platform", { platform })} disabled={!!busy} className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {busy === "platform" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
        </button>
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-100 bg-white p-5">
        <h2 className="flex items-center gap-3 font-semibold text-ink-950">Your Resend (platform emails) <HelpLink to="platform-email" /></h2>
        <p className="text-sm text-gray-600">Welcome / set-password emails, and every company&apos;s emails until it adds its own key.</p>
        {secretRow("resend_api_key", "Resend API key", "re_…")}
        <button
          onClick={async () => {
            if (await save("keys", { secrets: fields.collect(["resend_api_key"]) })) fields.clear();
          }}
          disabled={!!busy}
          className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy === "keys" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save keys
        </button>
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-100 bg-white p-5">
        <h2 className="font-semibold text-ink-950">Paid services</h2>
        {packages.map((p, i) => (
          <div key={i} className="grid gap-2 rounded-xl border border-gray-100 p-3 sm:grid-cols-[1fr_1fr_90px_auto]">
            <input value={p.name} onChange={(e) => setPackages(packages.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
            <input value={p.code} onChange={(e) => setPackages(packages.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} placeholder="code" className="rounded-lg border border-gray-200 px-2 py-1.5 font-mono text-sm" />
            <input value={String(p.price)} onChange={(e) => setPackages(packages.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) || 0 } : x)))} placeholder="£" className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
            <button onClick={() => setPackages(packages.filter((_, j) => j !== i))} aria-label="Remove package" className="text-gray-400 hover:text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
            <textarea value={p.description} onChange={(e) => setPackages(packages.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder="What's included" rows={2} className="rounded-lg border border-gray-200 p-2 text-sm sm:col-span-4" />
          </div>
        ))}
        <button onClick={() => setPackages([...packages, { code: `pkg-${packages.length + 1}`, name: "", price: 0, description: "" }])} className="flex items-center gap-1 text-sm font-semibold text-brand-600">
          <Plus className="h-4 w-4" /> Add package
        </button>
        <label className="block text-sm">
          <span className="font-medium text-gray-700">Price of a restore for plans without self-service backups (£)</span>
          <input value={restorePrice} onChange={(e) => setRestorePrice(e.target.value)} className="mt-1 w-32 rounded-xl border border-gray-200 px-3 py-2" />
        </label>
        <button onClick={() => save("services", { services: { setup_packages: packages, restore_price: restorePrice } })} disabled={!!busy} className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {busy === "services" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
        </button>
      </section>
    </div>
  );
}
