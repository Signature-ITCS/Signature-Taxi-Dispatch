import { decodePolyline } from "@/lib/polyline";

/**
 * The route a dispatcher picked when booking (saved in bookings.fare_breakdown.route),
 * and Google Maps links that make the driver's navigation follow it.
 *
 * Google Maps can't be handed a route line, but it routes through the waypoints
 * it's given. So the link passes the job's stops plus a few points sampled along
 * the chosen route, in travel order — Google then has to take the same roads.
 */

type LL = { lat: number; lng: number };
export type ChosenRoute = { label: string; polyline: string };

export function chosenRoute(fareBreakdown: unknown): ChosenRoute | null {
  const r = (fareBreakdown as { route?: { label?: unknown; polyline?: unknown } } | null)?.route;
  return r && typeof r.polyline === "string" && r.polyline ? { label: String(r.label ?? ""), polyline: r.polyline } : null;
}

const d2 = (a: LL, b: LL) => (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2;
const fmt = (p: LL) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/** Google Maps allows 9 waypoints in a link; keep one spare. */
const MAX_WAYPOINTS = 8;

/**
 * Points for navigation from the pick-up to the drop-off: every stop, plus guide
 * points along the chosen route (if any), sorted in the order they're driven.
 */
export function dropoffWaypoints(stops: LL[], route: ChosenRoute | null): LL[] {
  if (!route) return stops.slice(0, MAX_WAYPOINTS);
  const path = decodePolyline(route.polyline);
  if (path.length < 3) return stops.slice(0, MAX_WAYPOINTS);
  // Where along the route each stop is.
  const at = (p: LL) => path.reduce((best, q, i) => (d2(q, p) < d2(path[best], p) ? i : best), 0);
  const items: { i: number; p: LL }[] = stops.map((p) => ({ i: at(p), p }));
  const guides = Math.max(0, Math.min(5, MAX_WAYPOINTS - stops.length));
  for (let k = 1; k <= guides; k++) {
    const i = Math.round((k * (path.length - 1)) / (guides + 1));
    items.push({ i, p: path[i] });
  }
  return items.sort((a, b) => a.i - b.i).map((x) => x.p);
}

/** Google Maps turn-by-turn to a point, through optional waypoints (opens the Maps app on phones). */
export function navUrl(dest: LL | null, address: string, waypoints: LL[] = []): string {
  const d = dest ? fmt(dest) : encodeURIComponent(address);
  const w = waypoints.length ? `&waypoints=${waypoints.map(fmt).join("%7C")}` : "";
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${d}${w}`;
}
