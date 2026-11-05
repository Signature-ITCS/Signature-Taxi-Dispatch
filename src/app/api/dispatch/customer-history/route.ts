import { NextResponse } from "next/server";
import { getOfficeContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenantDb";
import { normalizeWhatsapp } from "@/lib/format";

/**
 * Staff only: a caller's earlier journeys with this company, found by phone
 * number, so a regular's addresses ("pick me up from home") can be filled in
 * with one click. Only the signed-in staff member's own company is searched.
 *
 * GET ?phone=… → { customer, journeys (newest 25), places (most used) }
 */
type Row = {
  booking_number: string;
  created_at: string;
  scheduled_at: string | null;
  status: string;
  pickup_address: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_address: string;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  via_points: { address?: string; lat?: number | null; lng?: number | null }[] | null;
  estimated_fare: number | null;
  passengers: number | null;
  vehicle_categories: { name: string } | null;
};

export async function GET(req: Request) {
  const office = await getOfficeContext();
  if (!office) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const phone = normalizeWhatsapp(new URL(req.url).searchParams.get("phone"));
  if (phone.length < 7) return NextResponse.json({ ok: true, customer: null, journeys: [], places: [] });

  const db = tenantDb(office.company.id);
  // Stored numbers are as typed (07…, +44…, spaces): narrow by the last digits,
  // then compare the normalised numbers exactly.
  const { data: candidates } = await db
    .from("customers")
    .select("id, full_name, whatsapp, email, total_rides, is_blocked")
    .ilike("whatsapp", `%${phone.slice(-7)}%`)
    .limit(50);
  const matches = ((candidates ?? []) as { id: string; full_name: string; whatsapp: string; email: string | null; total_rides: number; is_blocked: boolean }[])
    .filter((c) => normalizeWhatsapp(c.whatsapp) === phone);
  if (!matches.length) return NextResponse.json({ ok: true, customer: null, journeys: [], places: [] });

  const { data } = await db
    .from("bookings")
    .select("booking_number, created_at, scheduled_at, status, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, via_points, estimated_fare, passengers, vehicle_categories!bookings_vehicle_category_id_fkey(name)")
    .in("customer_id", matches.map((m) => m.id))
    .order("created_at", { ascending: false })
    .limit(25);
  const journeys = ((data ?? []) as unknown as Row[]).map((b) => ({
    booking_number: b.booking_number,
    when: b.scheduled_at ?? b.created_at,
    status: b.status,
    pickup: { address: b.pickup_address, lat: b.pickup_lat, lng: b.pickup_lng },
    dropoff: { address: b.dropoff_address, lat: b.dropoff_lat, lng: b.dropoff_lng },
    vias: (b.via_points ?? []).filter((v) => v?.address).map((v) => ({ address: v.address as string, lat: v.lat ?? null, lng: v.lng ?? null })),
    fare: b.estimated_fare,
    passengers: b.passengers,
    vehicle: b.vehicle_categories?.name ?? null,
  }));

  // The places they use most (pickups and drop-offs), with their map points.
  const count = new Map<string, { address: string; lat: number | null; lng: number | null; uses: number }>();
  for (const j of journeys) {
    for (const p of [j.pickup, j.dropoff]) {
      const key = p.address.trim().toLowerCase();
      if (!key) continue;
      const cur = count.get(key);
      if (cur) {
        cur.uses++;
        if (cur.lat == null && p.lat != null) Object.assign(cur, { lat: p.lat, lng: p.lng });
      } else count.set(key, { ...p, uses: 1 });
    }
  }
  const places = [...count.values()].sort((a, b) => b.uses - a.uses).slice(0, 8);

  const best = matches.sort((a, b) => (b.total_rides ?? 0) - (a.total_rides ?? 0))[0];
  return NextResponse.json({
    ok: true,
    customer: { name: best.full_name, email: best.email, rides: best.total_rides, blocked: best.is_blocked },
    journeys,
    places,
  });
}
