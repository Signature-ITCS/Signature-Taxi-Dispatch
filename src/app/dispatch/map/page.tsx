"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, MapPin, Navigation, Radio, Smartphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLeaflet, createMap } from "@/lib/leafletMap";
import PageHeader from "@/components/admin/PageHeader";
import { cn } from "@/lib/format";

interface DriverRow {
  id: string;
  full_name: string;
  availability: "offline" | "online" | "on_trip";
  profile_id: string | null;
  is_blocked: boolean;
}
interface LocationRow {
  driver_id: string;
  lat: number;
  lng: number;
  updated_at: string;
}
interface ActiveJob {
  id: string;
  booking_number: string;
  status: string;
  driver_id: string;
  pickup_address: string;
  dropoff_address: string;
}

/** No position for this long and the driver shows as "no signal". */
const STALE_MS = 10 * 60_000;
/** How often the map asks for fresh positions. */
const POLL_MS = 15_000;

type Shown = "available" | "busy" | "offline";

const STYLE: Record<Shown, { label: string; color: string; chip: string }> = {
  available: { label: "Available", color: "#16a34a", chip: "bg-green-50 text-green-700" },
  busy: { label: "Busy", color: "#1d4ed8", chip: "bg-brand-50 text-brand-700" },
  offline: { label: "Offline", color: "#9ca3af", chip: "bg-gray-100 text-gray-500" },
};

const STATUS_TEXT: Record<string, string> = {
  assigned: "Assigned",
  accepted: "On the way to pick-up",
  driver_arrived: "Waiting at pick-up",
  in_progress: "Customer on board",
};

const ago = (iso: string, now: number) => {
  const m = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

/**
 * Dispatch → Map. Every app driver's last known position, coloured by status.
 *
 * Positions are polled (not pushed over realtime) — see driver_locations in
 * db/2026-10-13_driver_app.sql for why. Status changes arrive live.
 */
export default function DriverMapPage() {
  const [supabase] = useState(() => createClient());
  const { L } = useLeaflet();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef<Map<string, Marker>>(new Map());
  const fitted = useRef(false);

  const [drivers, setDrivers] = useState<DriverRow[] | null>(null);
  const [locations, setLocations] = useState<Record<string, LocationRow>>({});
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  // "Now", refreshed with each poll so "seen 3 min ago" stays current.
  const [now, setNow] = useState(() => Date.now());

  const loadDrivers = useCallback(async () => {
    const { data } = await supabase
      .from("drivers")
      .select("id, full_name, availability, profile_id, is_blocked")
      .eq("is_blocked", false)
      .order("full_name");
    setDrivers((data as DriverRow[]) ?? []);
  }, [supabase]);

  const loadPositions = useCallback(async () => {
    const [{ data: locs }, { data: active }] = await Promise.all([
      supabase.from("driver_locations").select("driver_id, lat, lng, updated_at"),
      supabase
        .from("bookings")
        .select("id, booking_number, status, driver_id, pickup_address, dropoff_address")
        .in("status", ["assigned", "accepted", "driver_arrived", "in_progress"])
        .not("driver_id", "is", null),
    ]);
    setLocations(Object.fromEntries(((locs as LocationRow[]) ?? []).map((l) => [l.driver_id, l])));
    setJobs((active as ActiveJob[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    loadDrivers();
    loadPositions();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") loadPositions();
      setNow(Date.now());
    }, POLL_MS);
    const ch = supabase
      .channel("driver-map")
      .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, () => loadDrivers())
      .subscribe();
    return () => {
      clearInterval(poll);
      supabase.removeChannel(ch);
    };
  }, [supabase, loadDrivers, loadPositions]);

  // Status is what the driver set in their app. Location freshness is shown
  // separately ("no location" / "seen 12 min ago") — a driver whose phone
  // hasn't sent a position is still online and can still be given jobs.
  const shownOf = useCallback((d: DriverRow): Shown => {
    if (d.availability === "offline") return "offline";
    if (d.availability === "on_trip") return "busy";
    return "available";
  }, []);
  const signalOf = (d: DriverRow) => {
    const loc = locations[d.id];
    if (!loc) return d.availability === "offline" ? "No location" : "Online — no location yet (location off on their phone?)";
    const stale = now - new Date(loc.updated_at).getTime() > STALE_MS;
    return stale ? `Last location ${ago(loc.updated_at, now)}` : `Seen ${ago(loc.updated_at, now)}`;
  };

  const appDrivers = useMemo(() => (drivers ?? []).filter((d) => d.profile_id), [drivers]);

  // "Leagrave Rd, Luton LU3" for each driver, looked up on the server (cached,
  // and only when a driver has moved to a new ~100 m square).
  const [areas, setAreas] = useState<Record<string, string>>({});
  const asked = useRef<Set<string>>(new Set());
  const areaKey = (l: LocationRow) => `${l.lat.toFixed(3)},${l.lng.toFixed(3)}`;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const d of appDrivers) {
        const loc = locations[d.id];
        if (!loc) continue;
        const k = areaKey(loc);
        if (asked.current.has(k)) continue;
        asked.current.add(k);
        try {
          const res = await fetch(`/api/geo/reverse?lat=${loc.lat}&lng=${loc.lng}`).then((r) => r.json());
          if (!cancelled && res?.ok && res.label) setAreas((a) => ({ ...a, [k]: res.label }));
        } catch {
          asked.current.delete(k);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appDrivers, locations]);
  const jobOf = (driverId: string) =>
    jobs
      .filter((j) => j.driver_id === driverId)
      .sort((a, b) => (a.status === "assigned" ? 1 : 0) - (b.status === "assigned" ? 1 : 0))[0];

  // Draw / move markers.
  useEffect(() => {
    if (!L || !el.current) return;
    if (!map.current) map.current = createMap(L, el.current, { zoom: 11, scrollWheelZoom: true });
    const m = map.current;
    const seen = new Set<string>();
    for (const d of appDrivers) {
      const loc = locations[d.id];
      if (!loc) continue;
      seen.add(d.id);
      const s = STYLE[shownOf(d)];
      // Anchored at the bottom tip of the pointer, so the tip sits on the driver.
      const html = `<div style="position:absolute;left:0;top:0;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;pointer-events:auto">
        <div class="bf-name" style="background:#0f172a;color:#fff;font:700 13px/1.2 system-ui,sans-serif;padding:4px 10px;border-radius:9999px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.35);margin-bottom:4px;border:2px solid ${s.color}"></div>
        <div style="width:46px;height:46px;border-radius:9999px;background:${s.color};border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>
        </div>
        <div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:10px solid ${s.color};margin-top:-2px"></div>
      </div>`;
      const icon = L.divIcon({ className: "", iconSize: [0, 0], html });
      let mk = markers.current.get(d.id);
      if (!mk) {
        mk = L.marker([loc.lat, loc.lng], { icon, title: d.full_name }).addTo(m);
        markers.current.set(d.id, mk);
      } else {
        mk.setLatLng([loc.lat, loc.lng]);
        mk.setIcon(icon);
      }
      // Name set as text, never as HTML.
      const label = mk.getElement()?.querySelector(".bf-name");
      if (label) label.textContent = d.full_name;
      mk.setZIndexOffset(shownOf(d) === "busy" ? 900 : shownOf(d) === "available" ? 800 : 0);
      const job = jobOf(d.id);
      mk.bindPopup(
        `<b>${escapeHtml(d.full_name)}</b><br>${areas[areaKey(loc)] ? `${escapeHtml(areas[areaKey(loc)])}<br>` : ""}${s.label} · seen ${ago(loc.updated_at, Date.now())}${
          job ? `<br>${escapeHtml(job.booking_number)} — ${escapeHtml(STATUS_TEXT[job.status] ?? job.status)}` : ""
        }`
      );
    }
    for (const [id, mk] of markers.current) {
      if (!seen.has(id)) {
        mk.remove();
        markers.current.delete(id);
      }
    }
    if (!fitted.current && seen.size) {
      fitted.current = true;
      const pts = [...seen].map((id) => [locations[id].lat, locations[id].lng] as [number, number]);
      if (pts.length === 1) m.setView(pts[0], 14);
      else m.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L, appDrivers, locations, jobs, shownOf, areas]);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
      markers.current.clear();
    },
    []
  );

  const focus = (d: DriverRow) => {
    const loc = locations[d.id];
    if (!loc || !map.current) return;
    map.current.setView([loc.lat, loc.lng], 15);
    markers.current.get(d.id)?.openPopup();
  };

  const counts = appDrivers.reduce(
    (c, d) => ({ ...c, [shownOf(d)]: c[shownOf(d)] + 1 }),
    { available: 0, busy: 0, offline: 0 } as Record<Shown, number>
  );

  return (
    <div>
      <PageHeader
        title="Driver map"
        help="calendar-map#map"
        subtitle={`${counts.available} available · ${counts.busy} busy · ${counts.offline} offline`}
      />
      <div className="grid gap-4 px-5 pb-24 md:grid-cols-[1fr_300px] md:px-8 md:pb-10">
        <div className="relative z-0 h-[60vh] overflow-hidden rounded-2xl border border-gray-200 bg-gray-100 md:h-[calc(100vh-170px)]">
          <div ref={el} className="h-full w-full" />
          {!L && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
            </div>
          )}
        </div>

        <aside className="space-y-2 md:max-h-[calc(100vh-170px)] md:overflow-y-auto">
          {drivers === null ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
            </div>
          ) : appDrivers.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-500">
              <Smartphone className="mb-2 h-6 w-6 text-gray-300" />
              No drivers use the driver app yet. Give a driver an app login in Admin → Drivers, and they&apos;ll appear here
              once they go online.
            </div>
          ) : (
            appDrivers
              .slice()
              .sort((a, b) => ["busy", "available", "offline"].indexOf(shownOf(a)) - ["busy", "available", "offline"].indexOf(shownOf(b)))
              .map((d) => {
                const shown = shownOf(d);
                const loc = locations[d.id];
                const job = jobOf(d.id);
                return (
                  <button
                    key={d.id}
                    onClick={() => focus(d)}
                    disabled={!loc}
                    className="block w-full rounded-2xl border border-gray-200 bg-white p-3 text-left transition-colors hover:border-brand-300 disabled:cursor-default disabled:hover:border-gray-200"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-ink-950">{d.full_name}</span>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", STYLE[shown].chip)}>
                        {STYLE[shown].label}
                      </span>
                    </div>
                    {loc && (
                      <p className="mt-1 flex items-start gap-1 text-sm font-medium text-ink-950">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
                        <span>{areas[areaKey(loc)] ?? "Finding location…"}</span>
                      </p>
                    )}
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
                      <Radio className="h-3 w-3" />
                      {signalOf(d)}
                    </p>
                    {job && (
                      <div className="mt-2 space-y-0.5 rounded-lg bg-gray-50 px-2 py-1.5 text-xs">
                        <p className="font-semibold text-ink-950">
                          {job.booking_number} · {STATUS_TEXT[job.status] ?? job.status}
                        </p>
                        <p className="flex items-center gap-1 truncate text-gray-500">
                          <MapPin className="h-3 w-3 shrink-0 text-green-600" /> {job.pickup_address}
                        </p>
                        <p className="flex items-center gap-1 truncate text-gray-500">
                          <Navigation className="h-3 w-3 shrink-0" /> {job.dropoff_address}
                        </p>
                      </div>
                    )}
                  </button>
                );
              })
          )}
        </aside>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
