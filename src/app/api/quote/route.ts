import { NextResponse } from "next/server";
import { callRpcCompat } from "@/lib/supabaseRest";
import { websiteForRequest, getOfficeContext } from "@/lib/tenant";
import { resolveLegDistance, type LegInput } from "@/lib/googleRoute";
import { clientIp, rateLimitShared } from "@/lib/rateLimit";

interface QuoteLeg extends LegInput {
  route_text?: string;
  scheduled_at?: string | null;
}

interface Quote {
  category_id: string;
  name: string;
  description: string | null;
  icon: string;
  capacity: number;
  suitcases: number;
  hand_bags: number;
  fare: { total: number; extras: { name: string; amount: number }[] };
}

async function legQuotes(
  key: string,
  leg: QuoteLeg
): Promise<{ quotes: Quote[]; child_seat_price: number } | null> {
  // Recompute distance from coordinates server-side so the quoted price
  // can't be lowered by a client that under-reports distance_km.
  // Public endpoint: coordinates or nothing. See resolveLegDistance().
  const resolved = await resolveLegDistance(leg);
  if (!resolved) return null;
  const { distance_km, duration_min } = resolved;
  // Coordinates let the database spot fixed area-to-area prices.
  const { data } = await callRpcCompat<{ ok: boolean; quotes: Quote[]; child_seat_price?: number }>(
    "quote_fares",
    {
      p_api_key: key,
      p_distance_km: distance_km,
      p_duration_min: duration_min,
      p_route_text: leg.route_text ?? "",
      ...(leg.scheduled_at ? { p_at: leg.scheduled_at } : {}),
    },
    {
      p_pickup_lat: leg.pickup_lat,
      p_pickup_lng: leg.pickup_lng,
      p_dropoff_lat: leg.dropoff_lat,
      p_dropoff_lng: leg.dropoff_lng,
      p_direct_km: resolved.direct_km,
    }
  );
  return data?.ok ? { quotes: data.quotes, child_seat_price: data.child_seat_price ?? 0 } : null;
}

export async function POST(req: Request) {
  // Each quote triggers up to 2 Google Directions lookups — throttle to blunt cost abuse.
  if (!(await rateLimitShared(`quote:${clientIp(req)}`, 30, 60_000))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const b = await req.json().catch(() => ({}));
  // Staff quote for their own company; the public for the website they are on.
  const office = await getOfficeContext();
  const site = await websiteForRequest(b.site, office?.company.id ?? null);
  if (!site) return NextResponse.json({ ok: false, error: "invalid_website" });
  const key = site.api_key;

  const outboundRes = await legQuotes(key, b.outbound ?? {});
  if (!outboundRes) return NextResponse.json({ ok: false, error: "quote_failed" });

  const outbound = outboundRes.quotes;
  const retRes = b.return ? await legQuotes(key, b.return) : null;
  const ret = retRes?.quotes ?? null;

  const quotes = outbound.map((q) => {
    const rq = ret?.find((r) => r.category_id === q.category_id) ?? null;
    return {
      category_id: q.category_id,
      name: q.name,
      description: q.description,
      icon: q.icon,
      capacity: q.capacity,
      suitcases: q.suitcases,
      hand_bags: q.hand_bags,
      fare: q.fare, // outbound breakdown
      outbound_total: q.fare.total,
      return_fare: rq ? rq.fare : null,
      return_total: rq ? rq.fare.total : 0,
      total: q.fare.total + (rq ? rq.fare.total : 0),
    };
  });

  return NextResponse.json({
    ok: true,
    quotes,
    hasReturn: !!ret,
    child_seat_price: outboundRes.child_seat_price,
  });
}
