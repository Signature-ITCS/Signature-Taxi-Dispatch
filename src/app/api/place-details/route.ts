import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { serverMapsKey } from "@/lib/googleKey";

type Details = { address: string | null; lat: number | null; lng: number | null };

/**
 * Google's postal address for a named place drops the name: Sheerness-on-Sea
 * station comes back as "Sheerness ME12 1NJ, UK" and Heathrow Airport as
 * "Hounslow, UK". For a named place (station, airport, hospital, hotel, shop…)
 * keep the name in front: "Sheerness-on-Sea Station, Sheerness ME12 1NJ, UK".
 * Plain street addresses are left exactly as Google gives them.
 */
function withPlaceName(address: string | null, name: string | null | undefined, types: string[] | null | undefined): string | null {
  if (!address || !name) return address;
  const t = types ?? [];
  const named = t.includes("establishment") || t.includes("point_of_interest") || t.includes("airport") || t.includes("transit_station");
  if (!named) return address;
  let label = name.trim();
  if (t.includes("train_station") && !/station/i.test(label)) label += " Station";
  if (address.toLowerCase().startsWith(label.toLowerCase())) return address;
  return `${label}, ${address}`;
}

/**
 * Resolve a place id to a formatted address (with the place's name for named
 * places — see withPlaceName) + coordinates.
 *
 * Places API (New) first, legacy Places as the fallback — the same place ids
 * work in both, so whichever API the key is allowed to use answers.
 */
export async function POST(req: Request) {
  if (!rateLimit(`place-details:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const { place_id } = await req.json().catch(() => ({ place_id: "" }));
  if (!place_id || typeof place_id !== "string") return NextResponse.json({ ok: false });

  const key = serverMapsKey();
  const r = (await detailsNew(place_id, key)) ?? (await detailsLegacy(place_id, key));
  if (!r) return NextResponse.json({ ok: false });
  return NextResponse.json({ ok: true, ...r });
}

async function detailsNew(placeId: string, key: string): Promise<Details | null> {
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": key,
        // Name + types keep a station's / airport's name in the address.
        "X-Goog-FieldMask": "formattedAddress,location,displayName,types",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const r = await res.json();
    return {
      address: withPlaceName(r.formattedAddress ?? null, r.displayName?.text, r.types),
      lat: r.location?.latitude ?? null,
      lng: r.location?.longitude ?? null,
    };
  } catch {
    return null;
  }
}

async function detailsLegacy(placeId: string, key: string): Promise<Details | null> {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
    placeId
  )}&fields=name,types,formatted_address,geometry&key=${key}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    const r = data.result;
    if (!r) {
      console.error("[place-details] Google refused both Places APIs", data.status, data.error_message);
      return null;
    }
    return {
      address: withPlaceName(r.formatted_address ?? null, r.name, r.types),
      lat: r.geometry?.location?.lat ?? null,
      lng: r.geometry?.location?.lng ?? null,
    };
  } catch {
    return null;
  }
}
