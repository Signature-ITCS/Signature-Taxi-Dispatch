"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, Layer } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useLeaflet, createMap, dotMarker } from "@/lib/leafletMap";
import { fetchRoutePath } from "@/lib/polyline";

type Pt = { lat: number; lng: number };

/** Straight-line distance in metres — enough to decide when to re-route. */
function metres(a: Pt, b: Pt): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * The map inside a job: where the driver is, and the road route to where they
 * are going next — the pick-up before the passenger is on board, the drop-off
 * after. Turn-by-turn directions are one tap away in Google Maps; this is the
 * at-a-glance view.
 *
 * Routes come from our server (Google Routes API, billed per request), so the
 * line is only re-fetched when the stage changes or the driver has moved a fair
 * way from where it was last drawn.
 */
export default function JobMap({
  me,
  pickup,
  dropoff,
  vias,
  stage,
}: {
  me: Pt | null;
  pickup: Pt | null;
  dropoff: Pt | null;
  vias: Pt[];
  /** "to_pickup" until the customer is picked up, then "to_dropoff". */
  stage: "to_pickup" | "to_dropoff";
}) {
  const { L, error } = useLeaflet();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef<Layer[]>([]);
  const meMarker = useRef<Layer | null>(null);
  const route = useRef<Layer[]>([]);
  const routedFrom = useRef<{ key: string; from: Pt | null } | null>(null);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
    },
    []
  );

  // Stops (pick-up, vias, drop-off) — redrawn when the job or stage changes.
  useEffect(() => {
    if (!L || !el.current) return;
    if (!map.current) map.current = createMap(L, el.current, { zoom: 13, scrollWheelZoom: true });
    const m = map.current;
    markers.current.forEach((x) => x.remove());
    markers.current = [];
    const pts: [number, number][] = [];
    const add = (p: Pt | null, color: string, title: string, glyph?: string) => {
      if (!p) return;
      markers.current.push(dotMarker(L, p.lat, p.lng, color, title, glyph, 200).addTo(m));
      pts.push([p.lat, p.lng]);
    };
    add(pickup, "#16a34a", "Pick-up", "A");
    vias.forEach((v, i) => add(v, "#6366f1", `Stop ${i + 1}`, String(i + 1)));
    add(dropoff, "#0f172a", "Drop-off", "B");
    if (me) pts.push([me.lat, me.lng]);
    m.invalidateSize();
    if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 });
    else if (pts.length === 1) m.setView(pts[0], 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, vias.length, stage]);

  // The driver's own position.
  useEffect(() => {
    if (!L || !map.current) return;
    meMarker.current?.remove();
    meMarker.current = me
      ? L.marker([me.lat, me.lng], {
          title: "You",
          zIndexOffset: 1000,
          icon: L.divIcon({
            className: "",
            iconSize: [22, 22],
            iconAnchor: [11, 11],
            html: '<div style="width:22px;height:22px;border-radius:9999px;background:#2563eb;border:4px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25)"></div>',
          }),
        }).addTo(map.current)
      : null;
  }, [L, me]);

  // The road route to the next stop.
  useEffect(() => {
    if (!L || !map.current) return;
    const target = stage === "to_pickup" ? pickup : dropoff;
    if (!target) return;
    // To pick-up: from the driver if we know where they are, else from the pick-up itself.
    const from = stage === "to_pickup" ? me : pickup;
    const key = `${stage}:${target.lat},${target.lng}`;
    const last = routedFrom.current;
    const moved = last?.from && from ? metres(last.from, from) : Infinity;
    if (last && last.key === key && (from === null || moved < 400) && !(last.from === null && from)) return;
    routedFrom.current = { key, from };

    let cancelled = false;
    const origin = from ?? pickup ?? target;
    const waypoints = stage === "to_dropoff" ? vias : [];
    fetchRoutePath(origin, target, waypoints).then((path) => {
      if (cancelled || !path || !map.current) return;
      route.current.forEach((x) => x.remove());
      const ll = path.map((p) => [p.lat, p.lng] as [number, number]);
      route.current = [
        L.polyline(ll, { color: "#ffffff", weight: 9, opacity: 0.95 }).addTo(map.current),
        L.polyline(ll, { color: stage === "to_pickup" ? "#16a34a" : "#1d4ed8", weight: 5 }).addTo(map.current),
      ];
    });
    return () => {
      cancelled = true;
    };
  }, [L, me, pickup, dropoff, vias, stage]);

  if (error) return null;
  return <div ref={el} className="relative z-0 h-56 w-full overflow-hidden rounded-xl bg-gray-100" />;
}
