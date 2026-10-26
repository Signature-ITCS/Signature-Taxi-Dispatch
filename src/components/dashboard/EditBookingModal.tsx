"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, X, Plus, Trash2, MapPin, Navigation, CircleDot, Save, Calculator, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import AddressAutocomplete, { type PlaceValue } from "@/components/booking/AddressAutocomplete";
import PhoneInput from "@/components/PhoneInput";
import { money, cn } from "@/lib/format";
import type { Booking } from "@/lib/types";

/**
 * Edit an existing booking: customer, pickup / stops / drop-off, time, vehicle,
 * passengers and luggage, child seat, notes, and the price (keep it,
 * recalculate it like a new booking, or type one). Saved through
 * /api/dispatch/booking-edit, which re-measures the route and prices it on the
 * server and tells the assigned driver what changed.
 *
 * Closes only from ✕ / Cancel, so a stray click can't lose the edits.
 */

type FareMode = "keep" | "recalculate" | "custom";
const ERRORS: Record<string, string> = {
  invalid_phone: "That phone number doesn't look right.",
  invalid_email: "That email address doesn't look right.",
  missing_address: "Pickup and drop-off are both needed.",
  pick_from_list: "Choose each changed address from the suggestions list, so the route can be measured.",
  no_route: "Couldn't find a driving route between those addresses.",
  invalid_time: "That pickup time isn't valid.",
  invalid_category: "Choose a vehicle type.",
  invalid_fare: "Enter a valid price.",
  quote_failed: "Couldn't work out the new price. Try again, or set the price yourself.",
  not_found: "This booking no longer exists.",
  unauthorized: "Only admins and dispatchers can edit bookings.",
  save_failed: "Couldn't save the changes. Please try again.",
};

/** ISO → value for <input type="datetime-local"> in this computer's time (UK for the office). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function EditBookingModal({
  booking,
  onClose,
  onSaved,
}: {
  booking: Booking;
  onClose: () => void;
  onSaved: (updated: Booking) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [cats, setCats] = useState<{ id: string; name: string; is_active: boolean }[]>([]);

  const [name, setName] = useState(booking.customer_name ?? "");
  const [phone, setPhone] = useState(booking.customer_whatsapp ?? "");
  const [email, setEmail] = useState(booking.customer_email ?? "");
  const [pickup, setPickup] = useState<PlaceValue>({ address: booking.pickup_address, lat: booking.pickup_lat, lng: booking.pickup_lng });
  const [dropoff, setDropoff] = useState<PlaceValue>({ address: booking.dropoff_address, lat: booking.dropoff_lat, lng: booking.dropoff_lng });
  const [vias, setVias] = useState<PlaceValue[]>(
    (booking.via_points ?? []).filter((v) => v.address).map((v) => ({ address: v.address, lat: v.lat, lng: v.lng }))
  );
  const [asap, setAsap] = useState(!booking.scheduled_at);
  const [when, setWhen] = useState(toLocalInput(booking.scheduled_at));
  const [categoryId, setCategoryId] = useState(booking.vehicle_category_id ?? "");
  const [passengers, setPassengers] = useState(booking.passengers ?? 1);
  const [suitcases, setSuitcases] = useState(booking.suitcases ?? 0);
  const [handLuggage, setHandLuggage] = useState(booking.hand_luggage ?? 0);
  const [childSeat, setChildSeat] = useState(!!booking.child_seat);
  const [notes, setNotes] = useState(booking.notes ?? "");
  const [fareMode, setFareMode] = useState<FareMode>("keep");
  const [customFare, setCustomFare] = useState(String(booking.estimated_fare ?? ""));

  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ fare: number; old_fare: number; warnings: string[] } | null>(null);

  useEffect(() => {
    supabase
      .from("vehicle_categories")
      .select("id, name, is_active")
      .order("sort_order")
      .then(({ data }) => setCats((data as { id: string; name: string; is_active: boolean }[]) ?? []));
  }, [supabase]);

  // Anything that moves the price → suggest recalculating it (staff can still keep it).
  const priceAffecting =
    pickup.address !== booking.pickup_address ||
    dropoff.address !== booking.dropoff_address ||
    JSON.stringify(vias.map((v) => v.address)) !== JSON.stringify((booking.via_points ?? []).filter((v) => v.address).map((v) => v.address)) ||
    categoryId !== booking.vehicle_category_id ||
    childSeat !== !!booking.child_seat ||
    asap !== !booking.scheduled_at ||
    (!asap && when !== toLocalInput(booking.scheduled_at));
  const [touchedFare, setTouchedFare] = useState(false);
  useEffect(() => {
    if (!touchedFare) setFareMode(priceAffecting ? "recalculate" : "keep");
  }, [priceAffecting, touchedFare]);
  useEffect(() => setPreview(null), [priceAffecting, fareMode, customFare, pickup, dropoff, vias, categoryId, childSeat, when, asap]);

  const body = (previewOnly: boolean) => ({
    id: booking.id,
    preview: previewOnly,
    customer_name: name,
    customer_whatsapp: phone,
    customer_email: email || null,
    pickup,
    dropoff,
    via_points: vias.filter((v) => v.address.trim()),
    scheduled_at: asap ? null : when ? new Date(when).toISOString() : null,
    vehicle_category_id: categoryId,
    passengers,
    suitcases,
    hand_luggage: handLuggage,
    child_seat: childSeat,
    notes,
    fare_mode: fareMode,
    ...(fareMode === "custom" ? { custom_fare: Number(customFare) } : {}),
  });

  const send = async (previewOnly: boolean) => {
    if (!asap && !when) return setError("Choose the pickup date and time, or tick As soon as possible.");
    setBusy(previewOnly ? "preview" : "save");
    setError(null);
    try {
      const res = await fetch("/api/dispatch/booking-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body(previewOnly)),
      });
      const d = await res.json();
      setBusy(null);
      if (!d?.ok) return setError(ERRORS[d?.error] ?? "Couldn't save the changes. Please try again.");
      if (previewOnly) return setPreview({ fare: d.fare, old_fare: d.old_fare, warnings: d.warnings ?? [] });
      if (d.warnings?.length) alert(d.warnings.join("\n\n"));
      onSaved(d.booking as Booking);
      onClose();
    } catch {
      setBusy(null);
      setError("Couldn't save the changes. Please try again.");
    }
  };

  const field = "w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10";
  const label = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400";
  const done = booking.status === "completed" || booking.status === "cancelled";

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:max-h-[92vh] sm:max-w-xl sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-bold text-ink-950">Edit booking</h3>
            <p className="font-mono text-xs text-gray-500">{booking.booking_number}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {done && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This journey is {booking.status}. Edits correct the record (and its receipt) — nothing is sent to the customer.
            </p>
          )}

          {/* Customer */}
          <section className="space-y-3">
            <p className="font-display text-sm font-bold text-ink-950">Customer</p>
            <label className="block">
              <span className={label}>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
            </label>
            <div>
              <span className={label}>Phone</span>
              <PhoneInput value={phone} onChange={setPhone} />
            </div>
            <label className="block">
              <span className={label}>Email (optional)</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
            </label>
          </section>

          {/* Journey */}
          <section className="space-y-3">
            <p className="font-display text-sm font-bold text-ink-950">Journey</p>
            <AddressAutocomplete
              label="Pick-up"
              icon={MapPin}
              value={pickup.address}
              onChange={(a) => setPickup({ address: a, lat: null, lng: null })}
              onSelect={setPickup}
            />
            {vias.map((v, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <AddressAutocomplete
                    label={`Stop ${i + 1}`}
                    icon={CircleDot}
                    iconClass="text-gray-400"
                    value={v.address}
                    onChange={(a) => setVias((vs) => vs.map((x, j) => (j === i ? { address: a, lat: null, lng: null } : x)))}
                    onSelect={(p) => setVias((vs) => vs.map((x, j) => (j === i ? p : x)))}
                  />
                </div>
                <button
                  onClick={() => setVias((vs) => vs.filter((_, j) => j !== i))}
                  aria-label={`Remove stop ${i + 1}`}
                  className="mb-1 rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setVias((vs) => [...vs, { address: "", lat: null, lng: null }])}
              className="flex items-center gap-1.5 text-sm font-semibold text-brand-600"
            >
              <Plus className="h-4 w-4" /> Add stop
            </button>
            <AddressAutocomplete
              label="Drop-off"
              icon={Navigation}
              iconClass="text-ink-950"
              value={dropoff.address}
              onChange={(a) => setDropoff({ address: a, lat: null, lng: null })}
              onSelect={setDropoff}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
                <input type="checkbox" checked={asap} onChange={(e) => setAsap(e.target.checked)} className="h-4 w-4 accent-brand-600" />
                As soon as possible
              </label>
              {!asap && (
                <label className="block sm:col-span-2">
                  <span className={label}>Pickup date &amp; time</span>
                  <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={field} />
                </label>
              )}
            </div>
          </section>

          {/* Vehicle & load */}
          <section className="space-y-3">
            <p className="font-display text-sm font-bold text-ink-950">Vehicle &amp; passengers</p>
            <label className="block">
              <span className={label}>Vehicle type</span>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={field}>
                {cats
                  .filter((c) => c.is_active || c.id === booking.vehicle_category_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {!c.is_active ? " (switched off)" : ""}
                    </option>
                  ))}
              </select>
            </label>
            <div className="grid grid-cols-3 gap-3">
              <NumBox label="Passengers" value={passengers} min={1} onChange={setPassengers} cls={field} lbl={label} />
              <NumBox label="Suitcases" value={suitcases} min={0} onChange={setSuitcases} cls={field} lbl={label} />
              <NumBox label="Hand bags" value={handLuggage} min={0} onChange={setHandLuggage} cls={field} lbl={label} />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={childSeat} onChange={(e) => setChildSeat(e.target.checked)} className="h-4 w-4 accent-brand-600" />
              Child seat
            </label>
            <label className="block">
              <span className={label}>Notes</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={field} />
            </label>
          </section>

          {/* Price */}
          <section className="space-y-2">
            <p className="font-display text-sm font-bold text-ink-950">
              Price <span className="font-normal text-gray-400">· now {money(booking.estimated_fare)}</span>
            </p>
            {(
              [
                ["keep", "Keep the current price"],
                ["recalculate", "Recalculate for the new details (fixed area prices, per mile, extras)"],
                ["custom", "Set the price myself"],
              ] as [FareMode, string][]
            ).map(([k, t]) => (
              <label key={k} className={cn("flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-sm", fareMode === k ? "border-brand-300 bg-brand-50" : "border-gray-200")}>
                <input
                  type="radio"
                  name="fare"
                  checked={fareMode === k}
                  onChange={() => {
                    setTouchedFare(true);
                    setFareMode(k);
                  }}
                  className="mt-0.5 h-4 w-4 accent-brand-600"
                />
                <span>{t}</span>
              </label>
            ))}
            {fareMode === "custom" && (
              <div className="flex items-center rounded-xl border border-gray-200 px-3 focus-within:border-brand-400">
                <span className="text-sm text-gray-400">£</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={customFare}
                  onChange={(e) => setCustomFare(e.target.value)}
                  className="w-full bg-transparent px-2 py-2 text-sm outline-none"
                />
              </div>
            )}
            {fareMode !== "keep" && (
              <button
                onClick={() => send(true)}
                disabled={!!busy}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                {busy === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calculator className="h-3.5 w-3.5" />} Check new price
              </button>
            )}
            {preview && (
              <div className="rounded-xl bg-gray-50 px-3 py-2 text-sm">
                New price: <b>{money(preview.fare)}</b> <span className="text-gray-400">(was {money(preview.old_fare)})</span>
                {preview.warnings.map((w, i) => (
                  <p key={i} className="mt-1 text-xs text-amber-700">
                    {w}
                  </p>
                ))}
              </div>
            )}
          </section>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-gray-100 px-5 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
          <button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600">
            Cancel
          </button>
          <button
            onClick={() => send(false)}
            disabled={!!busy}
            className="flex flex-[2] items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save changes
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function NumBox({
  label,
  value,
  min,
  onChange,
  cls,
  lbl,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (v: number) => void;
  cls: string;
  lbl: string;
}) {
  return (
    <label className="block">
      <span className={lbl}>{label}</span>
      <input type="number" min={min} max={99} value={value} onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))} className={cls} />
    </label>
  );
}
