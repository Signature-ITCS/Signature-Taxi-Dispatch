"use client";

import { useEffect, useRef, useState } from "react";
import {
  Loader2, Save, Check, Building2, BellRing, Plus, X, Mail, MessageSquare, CreditCard, Palette,
  KeyRound, Copy, CheckCircle2, Circle, LifeBuoy, Upload, Trash2, AlertTriangle,
} from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";

interface Config {
  name: string;
  legal_name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  timezone: string;
  primary_color: string;
  dark_color: string;
  logo_url: string;
  email_from: string;
  sms_sender: string;
  reply_to: string;
  booking_alert_emails: string[];
  alert_emails_saved: boolean;
  card_enabled: boolean;
}
interface SecretStatus {
  set: boolean;
  last4: string | null;
}
interface Loaded {
  config: Config;
  secrets: Record<string, SecretStatus>;
  encryption_ready: boolean;
  stripe_webhook_url: string;
  booking_url: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Marks a saved key for removal (an empty field means "leave it as it is"). */
const REMOVE = "__remove__";
const TIMEZONES = ["Europe/London", "Europe/Dublin", "Europe/Paris", "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "America/New_York", "UTC"];

const ERRORS: Record<string, string> = {
  invalid_email_from: "The sender address isn't a valid email address.",
  invalid_stripe_secret_key: "That doesn't look like a Stripe secret key (it starts sk_live_ or sk_test_).",
  invalid_stripe_webhook_secret: "That doesn't look like a Stripe webhook signing secret (it starts whsec_).",
  invalid_resend_api_key: "That doesn't look like a Resend API key (it starts re_).",
  encryption_not_configured: "Keys can't be saved yet: the platform's encryption key isn't set. Please contact support.",
};

export default function SettingsPage() {
  const [data, setData] = useState<Loaded | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/admin/settings").then((r) => r.json()).catch(() => null);
    if (res?.ok) {
      setData(res);
      setCfg(res.config);
      setSecrets({});
    } else setError("Could not load settings.");
  };
  useEffect(() => {
    load();
  }, []);

  const set = <K extends keyof Config>(k: K, v: Config[K]) => setCfg((c) => (c ? { ...c, [k]: v } : c));

  /** Save one section: the fields named, plus any keys typed into it. */
  const save = async (section: string, fields: (keyof Config)[], secretNames: string[] = []) => {
    if (!cfg) return;
    setSaving(section);
    setError(null);
    const body: Record<string, unknown> = {};
    for (const f of fields) body[f] = cfg[f];
    const s: Record<string, string> = {};
    for (const n of secretNames) {
      const v = secrets[n];
      if (v === REMOVE) s[n] = "";
      else if (v && v.trim()) s[n] = v.trim();
    }
    if (Object.keys(s).length) body.secrets = s;
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json()).catch(() => null);
    setSaving(null);
    if (!res?.ok) {
      setError(ERRORS[res?.error as string] ?? "Couldn't save. Try again.");
      return;
    }
    setSaved(section);
    setTimeout(() => setSaved(null), 2500);
    await load();
  };

  if (!cfg || !data) {
    return (
      <div>
        <PageHeader title="Settings" />
        {error ? <p className="text-sm text-red-600">{error}</p> : <Loader2 className="h-6 w-6 animate-spin text-brand-500" />}
      </div>
    );
  }

  const sec = data.secrets;
  const checklist: [string, boolean][] = [
    ["Company details", !!cfg.phone || !!cfg.email],
    ["Logo and colours", !!cfg.logo_url || cfg.primary_color.toLowerCase() !== "#1d4ed8"],
    ["SMS (Cosmic)", !!sec.cosmic_username?.set && !!sec.cosmic_password?.set],
    ["Card payments (Stripe)", cfg.card_enabled && !!sec.stripe_secret_key?.set],
    ["Booking alert emails", cfg.alert_emails_saved],
  ];

  const btn = { save, saving, saved };

  return (
    <div className="space-y-5 pb-16">
      <PageHeader title="Settings" subtitle="Your company's details, look, keys and notifications." />
      {error && (
        <p className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" /> {error}
        </p>
      )}

      {/* Checklist */}
      <Card icon={CheckCircle2} title="Setup checklist">
        <div className="grid gap-2 sm:grid-cols-2">
          {checklist.map(([label, ok]) => (
            <p key={label} className="flex items-center gap-2 text-sm text-gray-700">
              {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4 text-gray-300" />} {label}
            </p>
          ))}
        </div>
        <p className="mt-3 text-sm text-gray-600">
          Your booking page: <a href={data.booking_url} target="_blank" className="font-medium text-brand-600">{data.booking_url}</a>
        </p>
        <a href="/account" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-brand-600">
          <LifeBuoy className="h-4 w-4" /> Rather we set it up for you? See the setup packages
        </a>
      </Card>

      {/* Company */}
      <Card icon={Building2} title="Company details" note="Shown on your booking page, emails and receipts.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company name" value={cfg.name} onChange={(v) => set("name", v)} />
          <Field label="Legal name (receipts)" value={cfg.legal_name} onChange={(v) => set("legal_name", v)} placeholder="City Cars Ltd" />
          <Field label="Phone" value={cfg.phone} onChange={(v) => set("phone", v)} />
          <Field label="Email" value={cfg.email} onChange={(v) => set("email", v)} />
          <Field label="Website" value={cfg.website} onChange={(v) => set("website", v)} placeholder="https://citycars.co.uk" />
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Time zone</span>
            <select value={cfg.timezone} onChange={(e) => set("timezone", e.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2">
              {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2">
            <Field label="Address (receipts)" value={cfg.address} onChange={(v) => set("address", v)} />
          </div>
        </div>
        <div className="mt-4"><SaveBtn {...btn} section="company" fields={["name", "legal_name", "phone", "email", "website", "timezone", "address"]} /></div>
      </Card>

      {/* Branding */}
      <Card icon={Palette} title="Logo and colours" note="Used on your booking page, apps, emails and receipts.">
        <LogoUpload logoUrl={cfg.logo_url} onChanged={load} onRemove={() => { set("logo_url", ""); }} />
        <div className="mt-4 flex flex-wrap gap-6">
          <ColorField label="Main colour" value={cfg.primary_color} onChange={(v) => set("primary_color", v)} />
          <ColorField label="Dark colour" value={cfg.dark_color} onChange={(v) => set("dark_color", v)} />
          <div className="flex items-end gap-2">
            <span className="rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ background: cfg.primary_color }}>Book now</span>
            <span className="rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ background: cfg.dark_color }}>Header</span>
          </div>
        </div>
        <div className="mt-4"><SaveBtn {...btn} section="brand" fields={["primary_color", "dark_color", "logo_url"]} /></div>
      </Card>

      {/* Email */}
      <Card icon={Mail} title="Email" note="Booking confirmations, thank-you emails and alerts.">
        <p className="mb-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-600">
          Without your own Resend key, emails are sent by us, showing your company name. To send from your own address
          (e.g. bookings@yourdomain), verify your domain at resend.com, then add the key and address here.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Send from (your domain)" value={cfg.email_from} onChange={(v) => set("email_from", v)} placeholder="bookings@citycars.co.uk" />
          <Field label="Customer replies go to" value={cfg.reply_to} onChange={(v) => set("reply_to", v)} placeholder="office@citycars.co.uk" />
          <SecretField label="Resend API key" name="resend_api_key" status={sec.resend_api_key} values={secrets} setValues={setSecrets} placeholder="re_…" />
        </div>
        <div className="mt-4"><SaveBtn {...btn} section="email" fields={["email_from", "reply_to"]} secretNames={["resend_api_key"]} /></div>
      </Card>

      {/* SMS */}
      <Card icon={MessageSquare} title="SMS (Cosmic SMS)" note="Booking confirmations, “driver arrived” and “ride complete” texts.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sender name (max 11 letters/digits)" value={cfg.sms_sender} onChange={(v) => set("sms_sender", v.replace(/[^A-Za-z0-9]/g, "").slice(0, 11))} placeholder="CityCars" />
          <SecretField label="Cosmic username" name="cosmic_username" status={sec.cosmic_username} values={secrets} setValues={setSecrets} />
          <SecretField label="Cosmic API password" name="cosmic_password" status={sec.cosmic_password} values={secrets} setValues={setSecrets} />
        </div>
        <div className="mt-4"><SaveBtn {...btn} section="sms" fields={["sms_sender"]} secretNames={["cosmic_username", "cosmic_password"]} /></div>
      </Card>

      {/* Card payments */}
      <Card icon={CreditCard} title="Card payments (Stripe)" note="Customers pay on Stripe's own page; the money goes straight to your Stripe account.">
        <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-gray-600">
          <li>In your Stripe Dashboard → Developers → API keys, copy the <b>secret key</b> and paste it below.</li>
          <li>In Developers → Webhooks, add an endpoint with this address, for the events checkout.session.completed, checkout.session.expired, payment_intent.succeeded, payment_intent.payment_failed, charge.refunded, charge.dispute.created and charge.dispute.closed:</li>
        </ol>
        <CopyBox value={data.stripe_webhook_url} />
        <p className="mb-3 mt-2 text-sm text-gray-600">3. Paste that webhook&apos;s <b>signing secret</b> below, save, then switch card payments on.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <SecretField label="Stripe secret key" name="stripe_secret_key" status={sec.stripe_secret_key} values={secrets} setValues={setSecrets} placeholder="sk_live_…" />
          <SecretField label="Webhook signing secret" name="stripe_webhook_secret" status={sec.stripe_webhook_secret} values={secrets} setValues={setSecrets} placeholder="whsec_…" />
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cfg.card_enabled} onChange={(e) => set("card_enabled", e.target.checked)} className="h-4 w-4" />
          <span>Offer card payment to customers</span>
        </label>
        {cfg.card_enabled && !sec.stripe_secret_key?.set && !secrets.stripe_secret_key && (
          <p className="mt-1 text-xs text-amber-700">Card stays hidden from customers until the Stripe secret key is saved.</p>
        )}
        <div className="mt-4"><SaveBtn {...btn} section="stripe" fields={["card_enabled"]} secretNames={["stripe_secret_key", "stripe_webhook_secret"]} /></div>
      </Card>

      {/* Alerts */}
      <Card icon={BellRing} title="Booking alert emails" note="Who gets an email for every new booking, payment problem and pickup reminder.">
        <AlertList value={cfg.booking_alert_emails} onChange={(v) => set("booking_alert_emails", v)} />
        <div className="mt-4"><SaveBtn {...btn} section="alerts" fields={["booking_alert_emails"]} /></div>
      </Card>

      {!data.encryption_ready && (
        <p className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          <KeyRound className="h-4 w-4" /> Keys can&apos;t be saved yet — the platform&apos;s encryption key isn&apos;t configured.
        </p>
      )}
    </div>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

function SaveBtn({
  save,
  saving,
  saved,
  section,
  fields,
  secretNames,
}: {
  save: (section: string, fields: (keyof Config)[], secretNames?: string[]) => void;
  saving: string | null;
  saved: string | null;
  section: string;
  fields: (keyof Config)[];
  secretNames?: string[];
}) {
  return (
    <button
      onClick={() => save(section, fields, secretNames)}
      disabled={!!saving}
      className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
    >
      {saving === section ? <Loader2 className="h-4 w-4 animate-spin" /> : saved === section ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
      {saved === section ? "Saved" : "Save"}
    </button>
  );
}

function Card({ icon: Icon, title, note, children }: { icon: typeof Mail; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
        <Icon className="h-5 w-5 text-brand-600" /> {title}
      </h2>
      {note && <p className="mb-4 mt-0.5 text-sm text-gray-500">{note}</p>}
      {!note && <div className="mb-3" />}
      {children}
    </section>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-gray-700">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 outline-none focus:border-brand-500" />
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-gray-700">{label}</span>
      <span className="mt-1 flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-gray-200" />
        <input value={value} onChange={(e) => onChange(e.target.value)} className="w-24 rounded-xl border border-gray-200 px-2 py-1.5 font-mono text-xs" />
      </span>
    </label>
  );
}

/** A key or password: once saved, never shown again — only replaced or removed. */
function SecretField({
  label, name, status, values, setValues, placeholder,
}: {
  label: string;
  name: string;
  status?: SecretStatus;
  values: Record<string, string>;
  setValues: (fn: (v: Record<string, string>) => Record<string, string>) => void;
  placeholder?: string;
}) {
  const editing = name in values;
  if (values[name] === REMOVE) {
    return (
      <div className="text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        <div className="mt-1 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
          Will be removed when you save
          <button
            type="button"
            onClick={() =>
              setValues((v) => {
                const n = { ...v };
                delete n[name];
                return n;
              })
            }
            className="ml-auto font-semibold"
          >
            Undo
          </button>
        </div>
      </div>
    );
  }
  if (status?.set && !editing) {
    return (
      <div className="text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        <div className="mt-1 flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
          <KeyRound className="h-4 w-4 text-emerald-600" />
          <span className="font-mono text-xs text-gray-600">Saved ••••{status.last4}</span>
          <button type="button" onClick={() => setValues((v) => ({ ...v, [name]: "" }))} className="ml-auto text-xs font-semibold text-brand-600">Replace</button>
          <button type="button" title="Remove" onClick={() => setValues((v) => ({ ...v, [name]: REMOVE }))} className="text-gray-400 hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }
  return (
    <label className="block text-sm">
      <span className="font-medium text-gray-700">{label}</span>
      <input
        type="password"
        autoComplete="off"
        value={values[name] ?? ""}
        onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
        placeholder={status?.set ? "New value (leave empty to keep the saved one)" : placeholder}
        className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs outline-none focus:border-brand-500"
      />
    </label>
  );
}

function CopyBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
      <code className="flex-1 truncate text-xs text-gray-700">{value}</code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="flex items-center gap-1 text-xs font-semibold text-brand-600"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function LogoUpload({ logoUrl, onChanged, onRemove }: { logoUrl: string; onChanged: () => void; onRemove: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const upload = async (file: File) => {
    setErr(null);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setErr("Use a PNG, JPG or WebP image.");
    if (file.size > 1024 * 1024) return setErr("The logo must be under 1 MB.");
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/logo", { method: "POST", body: fd }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setErr("Upload failed. Try another image.");
    onChanged();
  };
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex h-16 w-40 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {logoUrl ? <img src={logoUrl} alt="Logo" className="max-h-14 max-w-36 object-contain" /> : <span className="text-xs text-gray-400">No logo — your name is shown</span>}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <button type="button" onClick={() => input.current?.click()} disabled={busy}
        className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-ink-950 disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload logo
      </button>
      {logoUrl && (
        <button type="button" onClick={onRemove} className="text-sm text-gray-500 hover:text-red-600">
          Remove (then Save)
        </button>
      )}
      {err && <p className="w-full text-sm text-red-600">{err}</p>}
    </div>
  );
}

function AlertList({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const add = () => {
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) return setErr("Enter a valid email address.");
    if (!value.includes(e)) onChange([...value, e]);
    setEmail("");
    setErr(null);
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {value.length === 0 && <p className="text-sm text-gray-500">Nobody — no booking alert emails are sent.</p>}
        {value.map((e) => (
          <span key={e} className="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
            {e}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== e))} aria-label={`Remove ${e}`}>
              <X className="h-3.5 w-3.5 text-gray-400 hover:text-red-600" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder="office@citycars.co.uk" className="w-full max-w-xs rounded-xl border border-gray-200 px-3 py-2 text-sm" />
        <button type="button" onClick={add} className="flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      {err && <p className="mt-1 text-sm text-red-600">{err}</p>}
    </div>
  );
}
