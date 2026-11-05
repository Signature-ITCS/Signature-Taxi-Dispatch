"use client";

import { useEffect, useState } from "react";
import { History, Loader2, MapPin, Navigation, ArrowLeftRight, Repeat, UserCheck, AlertTriangle } from "lucide-react";
import type { PlaceValue } from "@/components/booking/AddressAutocomplete";
import { isValidPhone, money } from "@/lib/format";

export interface PastJourney {
  booking_number: string;
  when: string;
  status: string;
  pickup: PlaceValue;
  dropoff: PlaceValue;
  vias: PlaceValue[];
  fare: number | null;
  passengers: number | null;
  vehicle: string | null;
}
interface Place extends PlaceValue {
  uses: number;
}
interface History {
  customer: { name: string; email: string | null; rides: number; blocked: boolean } | null;
  journeys: PastJourney[];
  places: Place[];
}

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "Europe/London" });

/**
 * Staff booking form only: once the caller's number is typed, their earlier
 * journeys and most-used places with this company. One click fills the trip
 * (or the trip reversed), or just the pick-up or drop-off.
 */
export default function CustomerHistory({
  phone,
  onTrip,
  onPlace,
  onCustomer,
}: {
  phone: string;
  onTrip: (j: PastJourney, reversed: boolean) => void;
  onPlace: (which: "pickup" | "dropoff", p: PlaceValue) => void;
  onCustomer: (c: { name: string; email: string | null }) => void;
}) {
  const [data, setData] = useState<History | null>(null);
  const [loading, setLoading] = useState(false);
  const valid = isValidPhone(phone);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const d = await fetch(`/api/dispatch/customer-history?phone=${encodeURIComponent(phone)}`)
        .then((r) => r.json())
        .catch(() => null);
      if (cancelled) return;
      setLoading(false);
      if (d?.ok) {
        setData(d);
        if (d.customer) onCustomer({ name: d.customer.name, email: d.customer.email });
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // onCustomer is a fresh closure each render; the phone number is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, valid]);

  if (!valid) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">
        <p className="flex items-center gap-2 font-semibold text-gray-600"><History className="h-4 w-4" /> Previous journeys</p>
        <p className="mt-1">Type the caller&apos;s number first — if they&apos;ve travelled with you before, their trips and addresses show here.</p>
      </div>
    );
  }
  if (loading && !data) return <div className="flex items-center gap-2 p-4 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Looking up the caller…</div>;
  if (!data?.customer) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
        <p className="flex items-center gap-2 font-semibold"><History className="h-4 w-4" /> New caller</p>
        <p className="mt-1">No earlier journeys for this number.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-gray-100 bg-gray-50 p-3 text-sm">
      <div className="flex items-start justify-between gap-2 px-1">
        <p className="flex items-center gap-2 font-semibold text-ink-950">
          <UserCheck className="h-4 w-4 text-emerald-600" /> {data.customer.name || "Returning caller"}
        </p>
        <span className="text-xs text-gray-500">{data.customer.rides || data.journeys.length} trip{(data.customer.rides || data.journeys.length) === 1 ? "" : "s"}</span>
      </div>
      {data.customer.blocked && (
        <p className="flex items-center gap-1.5 rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-700"><AlertTriangle className="h-3.5 w-3.5" /> This customer is blocked.</p>
      )}

      {data.places.length > 0 && (
        <div className="space-y-1.5">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Their places</p>
          {data.places.map((p) => (
            <div key={p.address} className="rounded-xl border border-gray-100 bg-white p-2">
              <p className="line-clamp-2 text-ink-950">{p.address}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => onPlace("pickup", p)} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:border-brand-300">
                  <MapPin className="h-3 w-3 text-brand-500" /> Pick up here
                </button>
                <button type="button" onClick={() => onPlace("dropoff", p)} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:border-brand-300">
                  <Navigation className="h-3 w-3" /> Drop here
                </button>
                <span className="ml-auto text-[11px] text-gray-400">used {p.uses}×</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Earlier journeys</p>
        {data.journeys.map((j) => (
          <div key={j.booking_number} className="rounded-xl border border-gray-100 bg-white p-2">
            <p className="flex justify-between gap-2 text-[11px] text-gray-500">
              <span>{when(j.when)} · {j.vehicle ?? "—"}{j.status === "cancelled" ? " · cancelled" : ""}</span>
              {j.fare != null && <span>{money(Number(j.fare))}</span>}
            </p>
            <p className="mt-0.5 line-clamp-1 text-ink-950"><MapPin className="mr-1 inline h-3 w-3 text-brand-500" />{j.pickup.address}</p>
            {j.vias.length > 0 && <p className="line-clamp-1 text-xs text-gray-500">via {j.vias.map((v) => v.address).join(" · ")}</p>}
            <p className="line-clamp-1 text-ink-950"><Navigation className="mr-1 inline h-3 w-3" />{j.dropoff.address}</p>
            <div className="mt-1.5 flex gap-1.5">
              <button type="button" onClick={() => onTrip(j, false)} className="flex items-center gap-1 rounded-lg bg-brand-600 px-2 py-1 text-xs font-semibold text-white hover:bg-brand-700">
                <Repeat className="h-3 w-3" /> Same trip
              </button>
              <button type="button" onClick={() => onTrip(j, true)} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:border-brand-300">
                <ArrowLeftRight className="h-3 w-3" /> Reverse
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
