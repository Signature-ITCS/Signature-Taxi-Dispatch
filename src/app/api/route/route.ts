import { NextResponse } from "next/server";
import { googleRouteDistance, googleRouteOptions, type Pt } from "@/lib/googleRoute";
import { rateLimit, clientIp } from "@/lib/rateLimit";

/** Driving distance + duration (and the route line) through optional via waypoints, via the Google Routes API. */
export async function POST(req: Request) {
  if (!rateLimit(`route:${clientIp(req)}`, 40, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const b = await req.json().catch(() => ({}));
  const o: Pt = b.origin;
  const d: Pt = b.destination;
  const waypoints: Pt[] = Array.isArray(b.waypoints) ? b.waypoints : [];
  if (!o?.lat || !d?.lat) return NextResponse.json({ ok: false });

  // { options: true } → every route Google offers (the dispatcher's route picker).
  if (b.options) {
    const options = await googleRouteOptions(o, d, waypoints);
    if (!options.length) return NextResponse.json({ ok: false });
    const def = options.find((x) => x.isDefault) ?? options[0];
    return NextResponse.json({ ok: true, km: def.km, min: def.min, polyline: def.polyline, options });
  }

  const r = await googleRouteDistance(o, d, waypoints);
  if (!r) return NextResponse.json({ ok: false });
  return NextResponse.json({ ok: true, km: r.km, min: r.min, polyline: r.polyline });
}
