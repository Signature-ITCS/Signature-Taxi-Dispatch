/**
 * Server-side Google Routes API helper.
 *
 * Used both by the /api/route endpoint (for the widget's live distance chip)
 * and by the quote/book/payment routes to RE-DERIVE trip distance from
 * coordinates server-side — so the fare can never be under-reported by a
 * client that lies about `distance_km`.
 */
import { serverMapsKey } from "@/lib/googleKey";

export interface Pt {
  lat: number | null | undefined;
  lng: number | null | undefined;
}

export interface LegInput {
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  via_points?: { lat: number | null; lng: number | null }[];
  distance_km?: number | null;
  duration_min?: number | null;
  /**
   * Staff only: the route the dispatcher picked from the options (its Google
   * description, e.g. "A249 and Swale Way", and its miles). Ignored for the
   * public — they always get Google's suggested route.
   */
  route_label?: string | null;
  route_km?: number | null;
}

export interface RouteOption {
  /** Google's name for the route, e.g. "M25" or "A249 and Swale Way". */
  label: string;
  km: number;
  min: number;
  polyline: string | null;
  /** Google's own pick (the fastest without traffic). */
  isDefault: boolean;
}

const hasCoord = (p?: Pt | null): p is { lat: number; lng: number } =>
  !!p && typeof p.lat === "number" && typeof p.lng === "number";

/**
 * Driving distance (MILES) + duration (min) through optional waypoints. Null on failure.
 * NOTE: the app works in miles (UK). The `km`/`distance_km` field names are kept
 * for compatibility but hold MILES.
 */
export async function googleRouteDistance(
  origin: Pt,
  destination: Pt,
  waypoints: Pt[] = []
): Promise<{ km: number; min: number; polyline: string | null } | null> {
  const key = serverMapsKey();
  if (!key || !hasCoord(origin) || !hasCoord(destination)) return null;

  const at = (p: { lat: number; lng: number }) => ({
    location: { latLng: { latitude: p.lat, longitude: p.lng } },
  });

  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: at(origin),
        destination: at(destination),
        intermediates: waypoints.filter(hasCoord).map(at),
        travelMode: "DRIVE",
        // Same answer the old Directions API gave by default: the route and
        // distance don't move with live traffic, so neither does the fare.
        routingPreference: "TRAFFIC_UNAWARE",
        units: "IMPERIAL",
      }),
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("[route] Google Routes API failed", res.status, data?.error?.message);
      return null;
    }
    const route = data.routes?.[0] as
      | { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }
      | undefined;
    if (!route?.distanceMeters) return null;
    // Duration comes back as a string of seconds, e.g. "1834s".
    const secs = parseFloat(route.duration ?? "0") || 0;
    return {
      km: Number((route.distanceMeters / 1609.344).toFixed(2)),
      min: Math.round(secs / 60),
      polyline: route.polyline?.encodedPolyline ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Every route Google offers between the points (its pick first, then up to two
 * alternatives), in MILES and minutes. Empty on failure.
 */
export async function googleRouteOptions(origin: Pt, destination: Pt, waypoints: Pt[] = []): Promise<RouteOption[]> {
  const key = serverMapsKey();
  if (!key || !hasCoord(origin) || !hasCoord(destination)) return [];
  const at = (p: { lat: number; lng: number }) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.description,routes.routeLabels",
      },
      body: JSON.stringify({
        origin: at(origin),
        destination: at(destination),
        intermediates: waypoints.filter(hasCoord).map(at),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        computeAlternativeRoutes: true,
        units: "IMPERIAL",
      }),
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("[route] Google route options failed", res.status, data?.error?.message);
      return [];
    }
    type R = { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string }; description?: string; routeLabels?: string[] };
    return ((data.routes ?? []) as R[])
      .filter((r) => r.distanceMeters)
      .map((r, i) => ({
        label: r.description || `Route ${i + 1}`,
        km: Number(((r.distanceMeters ?? 0) / 1609.344).toFixed(2)),
        min: Math.round((parseFloat(r.duration ?? "0") || 0) / 60),
        polyline: r.polyline?.encodedPolyline ?? null,
        isDefault: (r.routeLabels ?? []).includes("DEFAULT_ROUTE") || i === 0,
      }));
  } catch {
    return [];
  }
}

/** The option a dispatcher chose: same name, closest in miles. Null if it's no longer offered. */
export function matchRoute(options: RouteOption[], label?: string | null, km?: number | null): RouteOption | null {
  if (!label) return null;
  const same = options.filter((o) => o.label === label);
  if (!same.length) return null;
  if (km == null) return same[0];
  return same.reduce((a, b) => (Math.abs(b.km - km) < Math.abs(a.km - km) ? b : a));
}

/**
 * Trusted distance/duration for a booking leg.
 *
 * Distance is ALWAYS re-derived from coordinates via Google. The client's own
 * `distance_km` is only ever honoured when `trustClient` is set, which is
 * reserved for a signed-in staff member typing a phone booking by hand.
 *
 * For anything public this returns null rather than falling back, and the
 * caller refuses the request. That is deliberate: a request that simply omits
 * its coordinates used to be priced off `distance_km: 0`, turning a £257
 * airport run into £15. Refusing to price is the only safe failure here.
 */
export async function resolveLegDistance(
  leg: LegInput,
  opts: { trustClient?: boolean; allowRouteChoice?: boolean } = {}
): Promise<{ distance_km: number; duration_min: number; direct_km?: number; route?: { label: string; polyline: string } } | null> {
  const origin: Pt = { lat: leg.pickup_lat, lng: leg.pickup_lng };
  const destination: Pt = { lat: leg.dropoff_lat, lng: leg.dropoff_lng };
  const waypoints: Pt[] = (leg.via_points ?? []).map((v) => ({ lat: v.lat, lng: v.lng }));

  // Staff picked one of Google's routes: price THAT route. Looked up again here
  // (never the browser's numbers); if it's no longer offered, Google's pick is used.
  if (opts.allowRouteChoice && leg.route_label && hasCoord(origin) && hasCoord(destination)) {
    const withStops = waypoints.some(hasCoord);
    const [options, direct] = await Promise.all([
      googleRouteOptions(origin, destination, waypoints),
      withStops ? googleRouteDistance(origin, destination, []) : Promise.resolve(null),
    ]);
    const chosen = matchRoute(options, leg.route_label, leg.route_km);
    if (chosen)
      return {
        distance_km: chosen.km,
        duration_min: chosen.min,
        ...(direct ? { direct_km: direct.km } : {}),
        // Saved with the booking so the driver's navigation follows the same roads.
        ...(chosen.polyline ? { route: { label: chosen.label, polyline: chosen.polyline } } : {}),
      };
  }

  if (hasCoord(origin) && hasCoord(destination)) {
    // With stops, also measure the direct pickup → drop-off route: a fixed area
    // price charges the extra miles the stops add (see estimate_fare).
    const withStops = waypoints.some(hasCoord);
    const [r, direct] = await Promise.all([
      googleRouteDistance(origin, destination, waypoints),
      withStops ? googleRouteDistance(origin, destination, []) : Promise.resolve(null),
    ]);
    if (r) return { distance_km: r.km, duration_min: r.min, ...(direct ? { direct_km: direct.km } : {}) };
  }

  // No coordinates, or Google could not route them.
  if (!opts.trustClient) return null;

  return {
    distance_km: Number(leg.distance_km) || 0,
    duration_min: Number(leg.duration_min) || 0,
  };
}
