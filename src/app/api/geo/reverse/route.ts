import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/auth";

/**
 * Staff-only: "where is this?" for the driver map — a short area name such as
 * "Leagrave Rd, Luton LU3" for a driver's position.
 *
 * Uses OpenStreetMap's Nominatim (free, no key). Its usage policy asks for at
 * most one request a second and an identifying User-Agent, so positions are
 * rounded to ~100 m and cached: a driver who hasn't moved far is never looked
 * up twice, and the dispatch map only asks when a driver's area may have changed.
 */
const cache = new Map<string, string>();
let lastCall = 0;

export async function GET(req: Request) {
  const me = await getSessionProfile();
  if (!me || (me.role !== "admin" && me.role !== "dispatcher")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }

  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit) return NextResponse.json({ ok: true, label: hit });

  // Be a polite Nominatim client: never more than one request a second.
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&addressdetails=1&lat=${lat}&lon=${lng}`,
      {
        headers: {
          "User-Agent": "SignatureTransfersDispatch/1.0 (booking.airport-transfer.uk)",
          "Accept-Language": "en-GB,en",
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return NextResponse.json({ ok: false, error: "lookup_failed" });
    const data = (await res.json()) as { address?: Record<string, string>; display_name?: string };
    const label = shortLabel(data.address) ?? data.display_name?.split(",").slice(0, 3).join(",").trim() ?? null;
    if (!label) return NextResponse.json({ ok: false, error: "no_result" });
    if (cache.size > 2000) cache.clear();
    cache.set(key, label);
    return NextResponse.json({ ok: true, label });
  } catch {
    return NextResponse.json({ ok: false, error: "lookup_failed" });
  }
}

/** "Leagrave Rd, Luton LU3" — street, area or town, and the postcode district. */
function shortLabel(a?: Record<string, string>): string | null {
  if (!a) return null;
  const street = a.road ?? a.pedestrian ?? a.neighbourhood ?? null;
  const area = a.suburb ?? a.village ?? a.town ?? a.city_district ?? a.city ?? a.county ?? null;
  const town = a.town ?? a.city ?? null;
  const postcode = a.postcode ? a.postcode.split(" ")[0] : null;
  const place = [area, town && town !== area ? town : null].filter(Boolean).join(", ");
  const parts = [street, [place, postcode].filter(Boolean).join(" ")].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
