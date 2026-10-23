"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Loader2, Check, ExternalLink, Minus, Plus, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isValidPhone, cn } from "@/lib/format";
import PhoneInput from "@/components/PhoneInput";

/**
 * "Add a job we arranged somewhere else."
 *
 * The office takes a call with no driver free, books the customer an Uber, and
 * charges them directly. That ride is invisible to the system until someone
 * types it in — often the next day, once they remember. So this form is built
 * for entering the past: the date defaults to now but goes backwards freely,
 * and the status is chosen rather than assumed, because the ride has usually
 * already finished by the time anyone gets round to recording it.
 */

export interface ExternalBookingResult {
  booking_number: string;
  fare: number;
}

const ERRORS: Record<string, string> = {
  missing_fields: "Fill in the customer, both addresses and the fare.",
  invalid_phone: "That phone number doesn't look right.",
  invalid_fare: "Enter the amount the customer paid.",
  invalid_date: "That date isn't valid.",
  customer_blocked: "This customer is blocked.",
  unauthorized: "You don't have permission to add bookings.",
  no_service_role_key: "Server isn't configured to write bookings.",
};

/** Date → the value a <input type="datetime-local"> expects, in local time. */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function ExternalBookingModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved?: (result: ExternalBookingResult) => void;
}) {
  const supabase = createClient();
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);

  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => toLocalInput(new Date()));
  const [fare, setFare] = useState("");
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [payStatus, setPayStatus] = useState<"paid" | "pending">("paid");
  const [status, setStatus] = useState<"completed" | "pending" | "cancelled">("completed");
  const [categoryId, setCategoryId] = useState("");
  const [passengers, setPassengers] = useState(1);
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ExternalBookingResult | null>(null);

  useEffect(() => {
    supabase
      .from("vehicle_categories")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => setCategories((data as { id: string; name: string }[]) ?? []));
  }, [supabase]);

  const fareValue = Number(fare);
  const ready =
    name.trim().length > 1 &&
    isValidPhone(whatsapp) &&
    pickup.trim().length > 2 &&
    dropoff.trim().length > 2 &&
    fare.trim() !== "" &&
    Number.isFinite(fareValue) &&
    fareValue >= 0;

  const save = async () => {
    if (!ready) {
      setError("Fill in the customer, both addresses and the fare.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings/external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          whatsapp,
          email,
          pickup,
          dropoff,
          // datetime-local has no timezone; send the browser's real instant.
          occurred_at: new Date(occurredAt).toISOString(),
          fare: fareValue,
          payment_method: method,
          payment_status: payStatus,
          status,
          category_id: categoryId || null,
          passengers,
          notes,
        }),
      });
      const data = await res.json();
      setSaving(false);
      if (!data?.ok) {
        setError(ERRORS[data?.error] ?? "Could not save this booking. Please try again.");
        return;
      }
      const result = { booking_number: data.booking_number as string, fare: fareValue };
      setDone(result);
      onSaved?.(result);
    } catch {
      setSaving(false);
      setError("Could not save this booking. Please try again.");
    }
  };

  return (
    // Closes only from the ✕ button, so a stray click can't lose a half-filled form.
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:max-h-[90vh] sm:max-w-xl sm:rounded-2xl"
      >
        {/* Header stays put while the form scrolls under it */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <ExternalLink className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="font-display text-base font-bold leading-tight text-ink-950 sm:text-lg">
                Add an outside booking
              </h3>
              <p className="mt-0.5 text-xs text-gray-500 sm:text-[13px]">
                A job you arranged elsewhere — record it so the takings add up
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            aria-label="Close"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
              <Check className="h-7 w-7 text-green-600" strokeWidth={2.5} />
            </div>
            <p className="font-display text-lg font-bold text-ink-950">Booking recorded</p>
            <p className="mt-1 font-mono text-sm text-gray-500">{done.booking_number}</p>
            <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-gray-500">
              It now shows in bookings and counts towards your takings like any other ride.
            </p>
            <button
              onClick={onClose}
              className="mt-6 w-full rounded-xl bg-ink-950 py-3 font-semibold text-white transition-colors hover:bg-ink-800"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
              <Section title="Customer">
                <Field value={name} onChange={setName} placeholder="Full name" />
                <PhoneInput value={whatsapp} onChange={setWhatsapp} placeholder="Phone number" inputClassName="py-2.5 text-sm" />
                <Field value={email} onChange={setEmail} placeholder="Email (optional)" inputMode="email" />
              </Section>

              <Section title="Journey">
                <Field value={pickup} onChange={setPickup} placeholder="Pick-up address" />
                <Field value={dropoff} onChange={setDropoff} placeholder="Drop-off address" />
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Labeled label="When did it happen?">
                    <input
                      type="datetime-local"
                      value={occurredAt}
                      onChange={(e) => setOccurredAt(e.target.value)}
                      className={INPUT}
                    />
                  </Labeled>
                  <Labeled label="Car type (optional)">
                    <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={INPUT}>
                      <option value="">Not recorded</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Labeled>
                </div>
              </Section>

              <Section title="Money">
                <Labeled label="What the customer paid you">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-semibold text-gray-400">
                      £
                    </span>
                    <input
                      value={fare}
                      onChange={(e) => setFare(e.target.value)}
                      placeholder="0.00"
                      inputMode="decimal"
                      className="w-full rounded-xl border border-gray-200 py-3 pl-8 pr-3.5 text-lg font-bold text-ink-950 outline-none transition-colors focus:border-violet-400"
                    />
                  </div>
                </Labeled>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Choice
                    label="Paid by"
                    value={method}
                    onChange={setMethod}
                    options={[
                      ["cash", "Cash"],
                      ["card", "Card"],
                    ]}
                  />
                  <Choice
                    label="Money received?"
                    value={payStatus}
                    onChange={setPayStatus}
                    options={[
                      ["paid", "Received"],
                      ["pending", "Still owed"],
                    ]}
                  />
                </div>
              </Section>

              <Section title="Status">
                <Choice
                  label="Where did this job get to?"
                  value={status}
                  onChange={setStatus}
                  options={[
                    ["completed", "Completed"],
                    ["pending", "Pending"],
                    ["cancelled", "Cancelled"],
                  ]}
                />
                {/* A stepper, not a number box: typing over a "1" means clearing
                    it first, and a field that snaps back to 1 the moment it is
                    empty can never be changed. */}
                <Counter label="Passengers" value={passengers} onChange={setPassengers} min={1} max={16} />
                <Field value={notes} onChange={setNotes} placeholder="Notes (optional)" />
              </Section>

              {error && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>
              )}
            </div>

            {/* Action bar pinned to the bottom, clear of the phone's home bar */}
            <div className="shrink-0 border-t border-gray-100 bg-white px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] sm:px-6 sm:pb-3">
              <button
                onClick={save}
                disabled={saving || !ready}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-3.5 text-sm font-bold text-white transition-colors hover:bg-violet-700 disabled:bg-gray-200 disabled:text-gray-400"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Save booking
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

const INPUT =
  "w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-ink-950 outline-none transition-colors focus:border-violet-400";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">{title}</p>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function Field({
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  inputMode?: "tel" | "email" | "text";
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      className={INPUT}
    />
  );
}

function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div>
      {label && <span className="mb-1.5 block text-xs font-medium text-gray-500">{label}</span>}
      <div className="flex gap-2">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={cn(
              "flex-1 rounded-xl border px-2 py-2.5 text-[13px] font-semibold transition-colors",
              value === v
                ? "border-violet-500 bg-violet-50 text-violet-700"
                : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Counter({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  const btn =
    "flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition-colors hover:border-violet-400 hover:text-violet-600 disabled:cursor-not-allowed disabled:border-gray-100 disabled:text-gray-300";
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 px-3.5 py-2">
      <span className="flex items-center gap-2 text-sm text-ink-950">
        <Users className="h-4 w-4 text-gray-400" /> {label}
      </span>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className={btn}
          aria-label="Fewer passengers"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-6 text-center text-sm font-bold text-ink-950">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className={btn}
          aria-label="More passengers"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
