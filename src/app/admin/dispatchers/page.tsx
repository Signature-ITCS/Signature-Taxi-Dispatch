"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Plus, Check, X, Trash2, Headset, Mail, Phone, AlertTriangle, MailCheck, Smartphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import PageHeader from "@/components/admin/PageHeader";
import { cn } from "@/lib/format";

interface Dispatcher {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
}

export default function DispatchersPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Dispatcher[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [toDelete, setToDelete] = useState<Dispatcher | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email, phone, created_at")
      .eq("role", "dispatcher")
      .order("created_at", { ascending: false });
    setRows((data as Dispatcher[]) ?? []);
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <PageHeader
        title="Dispatchers"
        subtitle="Staff who log in to the dispatch board"
        action={
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" /> Add Dispatcher
          </button>
        }
      />

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-brand-600" />
        </div>
      ) : rows.length === 0 ? (
        <p className="px-5 py-16 text-center text-sm text-gray-400 md:px-8">
          No dispatchers yet — add your first one.
        </p>
      ) : (
        <div className="grid gap-4 px-5 pb-10 md:grid-cols-2 md:px-8">
          {rows.map((d, i) => (
            <motion.div
              key={d.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.04, 0.3) }}
              className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                    <Headset className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink-950">{d.full_name}</p>
                    <p className="flex items-center gap-1 truncate text-xs text-gray-500">
                      <Mail className="h-3 w-3 shrink-0" /> {d.email || "No email"}
                    </p>
                    {d.phone && (
                      <p className="flex items-center gap-1 truncate text-xs text-gray-400">
                        <Phone className="h-3 w-3 shrink-0" /> {d.phone}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setToDelete(d)}
                  title="Delete dispatcher"
                  aria-label="Delete dispatcher"
                  className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {showAdd && <AddDispatcher onClose={() => setShowAdd(false)} onDone={load} />}
      {toDelete && (
        <DeleteConfirm dispatcher={toDelete} onClose={() => setToDelete(null)} onDone={load} />
      )}
    </div>
  );
}

function AddDispatcher({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ full_name: "", email: "", password: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After a successful add: did the welcome email (login details + install link) go out?
  const [done, setDone] = useState<{ email: string; emailed: boolean } | null>(null);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const add = async () => {
    if (!form.full_name.trim() || !form.email.trim() || !form.password.trim()) {
      setError("Name, email and password are required.");
      return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/create-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          password: form.password,
          phone: form.phone.trim() || null,
          role: "dispatcher",
        }),
      });
      const data = await res.json();
      setSaving(false);
      if (!data?.ok) {
        setError(data?.error === "no_service_role_key" ? "Server not configured for staff creation." : "Could not add dispatcher. The email may already be in use.");
        return;
      }
      onDone();
      setDone({ email: form.email.trim(), emailed: !!data.emailed });
    } catch {
      setSaving(false);
      setError("Could not add dispatcher. Try again.");
    }
  };

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl"
        >
          <div
            className={cn(
              "mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full",
              done.emailed ? "bg-brand-50 text-brand-600" : "bg-amber-50 text-amber-600"
            )}
          >
            {done.emailed ? <MailCheck className="h-7 w-7" /> : <AlertTriangle className="h-7 w-7" />}
          </div>
          <h3 className="font-display text-lg font-bold text-ink-950">Dispatcher added</h3>
          {done.emailed ? (
            <>
              <p className="mt-1 text-sm text-gray-500">
                A welcome email with their login details has been sent to{" "}
                <span className="font-semibold text-ink-950">{done.email}</span>.
              </p>
              <p className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
                <Smartphone className="h-3.5 w-3.5 shrink-0" /> It includes an “Install the app” button for their phone or desktop.
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-gray-500">
              The account works, but the welcome email could not be sent. Please share the email and password
              with them directly.
            </p>
          )}
          <button
            onClick={onClose}
            className="mt-5 w-full rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Done
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
      >
        <h3 className="mb-1 font-display text-lg font-bold text-ink-950">Add Dispatcher</h3>
        <p className="mb-4 text-xs text-gray-400">They&apos;ll sign in at /login with this email &amp; password.</p>
        <div className="space-y-3">
          <Input value={form.full_name} onChange={(v) => set("full_name", v)} placeholder="Full name *" />
          <Input value={form.email} onChange={(v) => set("email", v)} placeholder="Email *" type="email" />
          <Input value={form.password} onChange={(v) => set("password", v)} placeholder="Password * (min 6 chars)" type="password" />
          <Input value={form.phone} onChange={(v) => set("phone", v)} placeholder="Phone (optional)" />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="mt-5 flex gap-2">
          <button
            onClick={add}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:bg-gray-300"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><Check className="h-4 w-4" /> Add Dispatcher</>)}
          </button>
          <button onClick={onClose} className="rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-200">
            <X className="h-4 w-4" />
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function DeleteConfirm({
  dispatcher,
  onClose,
  onDone,
}: {
  dispatcher: Dispatcher;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const del = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/delete-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: dispatcher.id }),
      });
      const data = await res.json();
      setBusy(false);
      if (!data?.ok) {
        setError("Could not delete this dispatcher. Please try again.");
        return;
      }
      onDone();
      onClose();
    } catch {
      setBusy(false);
      setError("Could not delete this dispatcher. Please try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h3 className="font-display text-lg font-bold text-ink-950">Delete {dispatcher.full_name}?</h3>
        <p className="mt-1 text-sm text-gray-500">
          This removes their login for the dispatch board. Past bookings are kept but no longer linked to
          them. This can&apos;t be undone.
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button
            onClick={del}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:bg-gray-300"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><Trash2 className="h-4 w-4" /> Delete</>)}
          </button>
          <button onClick={onClose} className="rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-200">
            Cancel
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10"
    />
  );
}
