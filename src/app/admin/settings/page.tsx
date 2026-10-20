"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Check, Building2, BellRing, Plus, X, Mail, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import { cn } from "@/lib/format";

interface Config {
  email_from: string;
  /** Where a customer's Reply goes (comma-separated). */
  reply_to: string;
  sms_sender: string;
  timezone: string;
  /** Exactly who receives the "New booking" alert email. */
  booking_alert_emails: string[];
  /** false until the admin has saved the list at least once (legacy: all staff). */
  alert_emails_saved: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TIMEZONES: { v: string; label: string }[] = [
  { v: "Europe/London", label: "UK — London (Europe/London)" },
  { v: "Europe/Dublin", label: "Ireland — Dublin (Europe/Dublin)" },
  { v: "Asia/Karachi", label: "Pakistan — Karachi (Asia/Karachi)" },
  { v: "Asia/Kolkata", label: "India — Kolkata (Asia/Kolkata)" },
  { v: "Asia/Dubai", label: "UAE — Dubai (Asia/Dubai)" },
  { v: "Europe/Paris", label: "Europe — Paris (Europe/Paris)" },
  { v: "America/New_York", label: "US East — New York" },
  { v: "America/Los_Angeles", label: "US West — Los Angeles" },
  { v: "Australia/Sydney", label: "Australia — Sydney" },
  { v: "UTC", label: "UTC" },
];

export default function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/settings");
      const data = await res.json();
      if (data?.ok) {
        setConfig(data.config);
      } else {
        setError("Could not load settings.");
      }
      setLoading(false);
    })();
  }, []);

  const setCfg = (k: keyof Config, v: string) => setConfig((c) => (c ? { ...c, [k]: v } : c));

  // Booking alert recipient list
  const [newEmail, setNewEmail] = useState("");
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [listSaving, setListSaving] = useState(false);
  const [listSaved, setListSaved] = useState(false);

  // Adding or removing an address saves the list at once — it used to wait for
  // "Save settings", and an address added without it was lost on refresh.
  const saveList = async (list: string[], undo: string[]) => {
    setListSaving(true);
    setListSaved(false);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_alert_emails: list }),
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error);
      setConfig((c) => (c ? { ...c, alert_emails_saved: true } : c));
      setListSaved(true);
      setTimeout(() => setListSaved(false), 1800);
    } catch {
      setConfig((c) => (c ? { ...c, booking_alert_emails: undo } : c));
      setEmailErr("Could not save the list. Please try again.");
    }
    setListSaving(false);
  };

  const addEmail = () => {
    const e = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) {
      setEmailErr("Enter a valid email address.");
      return;
    }
    if (config?.booking_alert_emails.includes(e)) {
      setEmailErr("That address is already on the list.");
      return;
    }
    if (!config) return;
    const before = config.booking_alert_emails;
    const list = [...before, e];
    setConfig({ ...config, booking_alert_emails: list });
    setNewEmail("");
    setEmailErr(null);
    saveList(list, before);
  };
  const removeEmail = (e: string) => {
    if (!config) return;
    const before = config.booking_alert_emails;
    const list = before.filter((x) => x !== e);
    setConfig({ ...config, booking_alert_emails: list });
    saveList(list, before);
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      setSaving(false);
      if (!data?.ok) {
        setError("Could not save. Please try again.");
        return;
      }
      setSaved(true);
      setConfig((c) => (c ? { ...c, alert_emails_saved: true } : c));
      setTimeout(() => setSaved(false), 1800);
    } catch {
      setSaving(false);
      setError("Could not save. Please try again.");
    }
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Notifications & timezone" />

      <div className="max-w-3xl space-y-6 px-5 pb-10 md:px-8">
        {loading || !config ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-brand-600" />
          </div>
        ) : (
          <>
            {/* Notifications & timezone */}
            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <h2 className="mb-4 flex items-center gap-2 font-display font-bold text-ink-950">
                <Building2 className="h-5 w-5 text-brand-600" /> Notifications &amp; timezone
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Timezone</span>
                  <select
                    value={config.timezone}
                    onChange={(e) => setCfg("timezone", e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10"
                  >
                    {config.timezone && !TIMEZONES.some((t) => t.v === config.timezone) && (
                      <option value={config.timezone}>{config.timezone}</option>
                    )}
                    {TIMEZONES.map((t) => (
                      <option key={t.v} value={t.v}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Field label="SMS sender ID" value={config.sms_sender} onChange={(v) => setCfg("sms_sender", v)} placeholder="TaxiService" />
                <Field label="Email sender (From)" value={config.email_from} onChange={(v) => setCfg("email_from", v)} placeholder="Taxi <bookings@domain>" full />
                <Field label="Customer replies go to" value={config.reply_to} onChange={(v) => setCfg("reply_to", v)} placeholder="office@gmail.com" full />
                <p className="-mt-2 text-[11px] leading-snug text-gray-400 sm:col-span-2">
                  When a customer presses Reply on any of our emails, it goes here. Leave blank to reply to the sender
                  address. Several addresses: separate with commas (the customer will see them all).
                </p>
              </div>
            </section>

            {/* Booking alert recipients */}
            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <h2 className="mb-1 flex items-center gap-2 font-display font-bold text-ink-950">
                <BellRing className="h-5 w-5 text-brand-600" /> Booking alert emails
              </h2>
              <p className="mb-4 text-xs text-gray-400">
                Every new booking sends a &ldquo;New booking received&rdquo; email to <b>exactly</b> these addresses. Add or
                remove anyone here — dispatcher logins don&apos;t need to match. Changes save straight away.
              </p>

              {!config.alert_emails_saved && (
                <p className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Not saved yet — right now alerts go to everyone with a staff login (listed below). Add or remove
                  an address (or press Save settings) to lock this list; after that only the addresses here get alerts.
                </p>
              )}

              <ul className="mb-3 divide-y divide-gray-50 overflow-hidden rounded-xl border border-gray-100">
                {config.booking_alert_emails.length === 0 && (
                  <li className="flex items-center gap-2 px-3.5 py-3 text-sm text-red-600">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> No addresses — nobody will be emailed about new bookings.
                  </li>
                )}
                {config.booking_alert_emails.map((e) => (
                  <li key={e} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="flex min-w-0 items-center gap-2 text-sm text-ink-950">
                      <Mail className="h-4 w-4 shrink-0 text-gray-400" />
                      <span className="truncate">{e}</span>
                    </span>
                    <button
                      onClick={() => removeEmail(e)}
                      aria-label={`Remove ${e}`}
                      title="Remove"
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>

              <div className="flex gap-2">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => {
                    setNewEmail(e.target.value);
                    setEmailErr(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addEmail();
                    }
                  }}
                  placeholder="name@example.com"
                  className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10"
                />
                <button
                  onClick={addEmail}
                  disabled={!newEmail.trim() || listSaving}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-40"
                >
                  {listSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
                </button>
              </div>
              {emailErr && <p className="mt-2 text-xs text-red-600">{emailErr}</p>}
              {listSaved && (
                <p className="mt-2 flex items-center gap-1 text-xs text-green-600">
                  <Check className="h-3.5 w-3.5" /> Saved — alerts go to these addresses.
                </p>
              )}
            </section>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              onClick={save}
              disabled={saving}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white transition-colors",
                saved ? "bg-green-600" : "bg-brand-600 hover:bg-brand-700"
              )}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? (<><Check className="h-4 w-4" /> Saved</>) : (<><Save className="h-4 w-4" /> Save settings</>)}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  full,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  full?: boolean;
}) {
  return (
    <label className={cn("block", full && "sm:col-span-2")}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10"
      />
    </label>
  );
}
