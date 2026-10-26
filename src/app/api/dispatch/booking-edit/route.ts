import { NextResponse } from "next/server";
import { getOfficeContext, companyWebsite } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenantDb";
import { createAdminClient } from "@/lib/supabase/admin";
import { callRpcCompat } from "@/lib/supabaseRest";
import { resolveLegDistance } from "@/lib/googleRoute";
import { isValidPhone } from "@/lib/format";
import { pushToDriver } from "@/lib/push";

/**
 * Staff-only: edit a booking that already exists — customer details, pickup,
 * stops, drop-off, time, vehicle, passengers/luggage, child seat, notes — and
 * its price.
 *
 * Price ("fare_mode"):
 *   keep        — leave the price as it is
 *   recalculate — price the edited trip exactly like a new booking would be
 *                 (fixed area prices, per-mile, extras, whole pounds)
 *   custom      — the price typed by staff, rounded to whole pounds
 *
 * `preview: true` works out and returns the new price without saving anything.
 * Distance is always re-measured on the server from the coordinates, so a
 * browser can't lower a price by sending its own numbers.
 *
 * Everything is read and written through tenantDb(the editor's company): a
 * booking, car class or price of another company is simply "not found".
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Place = { address: string; lat: number | null; lng: number | null };

interface EditBody {
  id: string;
  preview?: boolean;
  customer_name?: string;
  customer_whatsapp?: string;
  customer_email?: string | null;
  pickup?: Place;
  dropoff?: Place;
  via_points?: Place[];
  /** ISO time, or null for "as soon as possible". */
  scheduled_at?: string | null;
  vehicle_category_id?: string;
  passengers?: number;
  suitcases?: number;
  hand_luggage?: number;
  child_seat?: boolean;
  notes?: string | null;
  fare_mode?: "keep" | "recalculate" | "custom";
  custom_fare?: number;
}

const hasCoords = (p?: Place | null) => !!p && p.lat != null && p.lng != null && Number.isFinite(p.lat) && Number.isFinite(p.lng);
const sameNum = (a: unknown, b: unknown) => Math.abs(Number(a ?? NaN) - Number(b ?? NaN)) < 1e-7 || (a == null && b == null);

export async function POST(req: Request) {
  const office = await getOfficeContext();
  if (!office) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }
  const me = { id: office.userId, full_name: office.profile.full_name, role: office.profile.role };
  const companyId = office.company.id;
  const b = (await req.json().catch(() => ({}))) as EditBody;
  if (!b.id) return NextResponse.json({ ok: false, error: "missing_id" });

  const admin = tenantDb(companyId);
  const { data: cur, error: loadErr } = await admin.from("bookings").select("*").eq("id", b.id).maybeSingle();
  if (loadErr || !cur) return NextResponse.json({ ok: false, error: "not_found" });

  const patch: Record<string, unknown> = {};
  const changed: string[] = [];

  // ── Customer ──
  if (b.customer_name !== undefined) {
    const name = b.customer_name.trim() || "Customer";
    if (name !== cur.customer_name) { patch.customer_name = name; changed.push("customer name"); }
  }
  if (b.customer_whatsapp !== undefined) {
    const phone = b.customer_whatsapp.trim();
    if (!isValidPhone(phone)) return NextResponse.json({ ok: false, error: "invalid_phone" });
    if (phone !== cur.customer_whatsapp) { patch.customer_whatsapp = phone; changed.push("phone"); }
  }
  if (b.customer_email !== undefined) {
    const email = b.customer_email?.trim() || null;
    if (email && !EMAIL_RE.test(email)) return NextResponse.json({ ok: false, error: "invalid_email" });
    if (email !== (cur.customer_email ?? null)) { patch.customer_email = email; changed.push("email"); }
  }

  // ── Route ──
  const pickup: Place = b.pickup ?? { address: cur.pickup_address, lat: cur.pickup_lat, lng: cur.pickup_lng };
  const dropoff: Place = b.dropoff ?? { address: cur.dropoff_address, lat: cur.dropoff_lat, lng: cur.dropoff_lng };
  const vias: Place[] = (b.via_points ?? cur.via_points ?? []).filter((v: Place) => v?.address?.trim());
  const routeChanged =
    pickup.address !== cur.pickup_address ||
    !sameNum(pickup.lat, cur.pickup_lat) ||
    !sameNum(pickup.lng, cur.pickup_lng) ||
    dropoff.address !== cur.dropoff_address ||
    !sameNum(dropoff.lat, cur.dropoff_lat) ||
    !sameNum(dropoff.lng, cur.dropoff_lng) ||
    JSON.stringify(vias.map((v) => [v.address, v.lat, v.lng])) !==
      JSON.stringify(((cur.via_points ?? []) as Place[]).filter((v) => v?.address?.trim()).map((v) => [v.address, v.lat, v.lng]));

  let distance_km = Number(cur.distance_km) || 0;
  let duration_min = Number(cur.duration_min) || 0;
  let direct_km: number | undefined;
  if (routeChanged) {
    if (!pickup.address?.trim() || !dropoff.address?.trim()) return NextResponse.json({ ok: false, error: "missing_address" });
    if (!hasCoords(pickup) || !hasCoords(dropoff) || vias.some((v) => !hasCoords(v)))
      return NextResponse.json({ ok: false, error: "pick_from_list" });
    const r = await resolveLegDistance({
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_lat: dropoff.lat,
      dropoff_lng: dropoff.lng,
      via_points: vias.map((v) => ({ lat: v.lat, lng: v.lng })),
    });
    if (!r) return NextResponse.json({ ok: false, error: "no_route" });
    distance_km = r.distance_km;
    duration_min = r.duration_min;
    direct_km = r.direct_km;
    Object.assign(patch, {
      pickup_address: pickup.address.trim(),
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_address: dropoff.address.trim(),
      dropoff_lat: dropoff.lat,
      dropoff_lng: dropoff.lng,
      via_points: vias.map((v) => ({ address: v.address.trim(), lat: v.lat, lng: v.lng })),
      distance_km,
      duration_min,
    });
    changed.push("route");
  } else if (hasCoords(pickup) && hasCoords(dropoff) && vias.some(hasCoords)) {
    // Repricing an unchanged trip with stops still needs the direct distance.
    const r = await resolveLegDistance({
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_lat: dropoff.lat,
      dropoff_lng: dropoff.lng,
      via_points: vias.map((v) => ({ lat: v.lat, lng: v.lng })),
    });
    direct_km = r?.direct_km;
  }

  // ── Time ──
  if (b.scheduled_at !== undefined) {
    const next = b.scheduled_at ? new Date(b.scheduled_at) : null;
    if (next && Number.isNaN(next.getTime())) return NextResponse.json({ ok: false, error: "invalid_time" });
    const nextIso = next ? next.toISOString() : null;
    const curIso = cur.scheduled_at ? new Date(cur.scheduled_at).toISOString() : null;
    if (nextIso !== curIso) {
      patch.scheduled_at = nextIso;
      // New pickup time → the one-hour reminder should fire again for it.
      patch.reminder_sent_at = null;
      changed.push("pickup time");
    }
  }

  // ── Vehicle, people, luggage, child seat, notes ──
  if (b.vehicle_category_id !== undefined && b.vehicle_category_id !== cur.vehicle_category_id) {
    const { data: cat } = await admin.from("vehicle_categories").select("id").eq("id", b.vehicle_category_id).maybeSingle();
    if (!cat) return NextResponse.json({ ok: false, error: "invalid_category" });
    patch.vehicle_category_id = b.vehicle_category_id;
    changed.push("vehicle");
  }
  const int = (v: unknown, min: number) => Math.max(min, Math.min(99, Math.round(Number(v) || 0)));
  if (b.passengers !== undefined && int(b.passengers, 1) !== cur.passengers) { patch.passengers = int(b.passengers, 1); changed.push("passengers"); }
  if (b.suitcases !== undefined && int(b.suitcases, 0) !== cur.suitcases) { patch.suitcases = int(b.suitcases, 0); changed.push("suitcases"); }
  if (b.hand_luggage !== undefined && int(b.hand_luggage, 0) !== cur.hand_luggage) {
    patch.hand_luggage = int(b.hand_luggage, 0);
    changed.push("hand luggage");
  }
  if (b.child_seat !== undefined && !!b.child_seat !== !!cur.child_seat) { patch.child_seat = !!b.child_seat; changed.push("child seat"); }
  if (b.notes !== undefined) {
    const notes = b.notes?.trim() || null;
    if (notes !== (cur.notes ?? null)) { patch.notes = notes; changed.push("notes"); }
  }

  // ── Price ──
  const mode = b.fare_mode ?? "keep";
  let newFare: number | null = null;
  let breakdown: Record<string, unknown> | null = null;
  if (mode === "custom") {
    const v = Number(b.custom_fare);
    if (!Number.isFinite(v) || v < 0) return NextResponse.json({ ok: false, error: "invalid_fare" });
    newFare = Math.round(v);
    breakdown = { total: newFare, custom: true, note: "Custom price set by staff (edited booking)" };
  } else if (mode === "recalculate") {
    const key = (await companyWebsite(companyId))?.api_key;
    if (!key) return NextResponse.json({ ok: false, error: "invalid_website" });
    const catId = (patch.vehicle_category_id as string) ?? cur.vehicle_category_id;
    const sched = (patch.scheduled_at !== undefined ? patch.scheduled_at : cur.scheduled_at) as string | null;
    const routeText = [pickup.address, ...vias.map((v) => v.address), dropoff.address].filter(Boolean).join(" ");
    const { data } = await callRpcCompat<{
      ok: boolean;
      quotes: { category_id: string; fare: Record<string, unknown> & { total: number } }[];
      child_seat_price?: number;
    }>(
      "quote_fares",
      {
        p_api_key: key,
        p_distance_km: distance_km,
        p_duration_min: duration_min,
        p_route_text: routeText,
        ...(sched ? { p_at: sched } : {}),
      },
      {
        p_pickup_lat: pickup.lat,
        p_pickup_lng: pickup.lng,
        p_dropoff_lat: dropoff.lat,
        p_dropoff_lng: dropoff.lng,
        p_direct_km: direct_km,
      }
    );
    // A vehicle type switched off for customers can still be repriced for an existing job.
    let q = data?.ok ? data.quotes.find((x) => x.category_id === catId) : undefined;
    if (!q) {
      // catId is this company's (checked above, or the booking's own).
      const { data: f } = await createAdminClient().rpc("estimate_fare", {
        p_category_id: catId,
        p_distance_km: distance_km,
        p_duration_min: duration_min,
        p_pickup: routeText,
        p_dropoff: "",
        ...(sched ? { p_at: sched } : {}),
      });
      if (f && !(f as { error?: string }).error) q = { category_id: catId, fare: f as Record<string, unknown> & { total: number } };
    }
    if (!q) return NextResponse.json({ ok: false, error: "quote_failed" });
    newFare = Number(q.fare.total);
    breakdown = { ...q.fare };
    const childSeat = patch.child_seat !== undefined ? !!patch.child_seat : !!cur.child_seat;
    if (childSeat && !cur.is_return) {
      const seat = Math.round(Number(data?.child_seat_price) || 0);
      if (seat > 0) {
        newFare += seat;
        breakdown.total = newFare;
        breakdown.extras = [...((breakdown.extras as unknown[]) ?? []), { name: "Child seat", amount: seat, type: "fixed" }];
      }
    }
  }
  const oldFare = Number(cur.estimated_fare ?? 0);
  if (newFare != null && newFare !== oldFare) {
    patch.estimated_fare = newFare;
    // A completed job's final price follows the edit too.
    if (cur.final_fare != null) patch.final_fare = newFare;
    changed.push("price");
  }
  if (breakdown && newFare != null) patch.fare_breakdown = breakdown;

  const warnings: string[] = [];
  if (newFare != null && newFare !== oldFare && cur.payment_status === "paid") {
    warnings.push(
      cur.stripe_payment_intent_id
        ? `Already paid online (${money(oldFare)}). Collect or refund the difference in the Stripe dashboard.`
        : `Already marked paid (${money(oldFare)}). Collect or refund the difference.`
    );
  }
  if (cur.trip_group_id) warnings.push("This is one leg of a return trip — only this leg was changed.");

  if (b.preview) {
    return NextResponse.json({ ok: true, preview: true, fare: newFare ?? oldFare, old_fare: oldFare, distance_km, changed, warnings });
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, changed: [], warnings, booking: cur });

  const { data: saved, error: saveErr } = await admin.from("bookings").update(patch).eq("id", b.id).select("*").single();
  if (saveErr || !saved) {
    console.error("[booking-edit] save failed", saveErr);
    return NextResponse.json({ ok: false, error: "save_failed" });
  }

  const summary = `${cur.booking_number}: ${changed.join(", ")}${patch.estimated_fare != null ? ` (price ${money(oldFare)} → ${money(newFare ?? 0)})` : ""}`;
  // Best-effort side effects — the edit is already saved.
  try {
    await admin.from("activity_logs").insert({
      actor_id: me.id,
      actor_name: me.full_name,
      actor_role: me.role,
      action: "booking_edited",
      description: `Edited booking ${summary}`,
    });
    await admin.from("staff_notifications").insert({
      kind: "edited",
      severity: "info",
      title: `${cur.booking_number} edited`,
      body: `${changed.join(", ")} · by ${me.full_name || "staff"}`,
      booking_id: cur.id,
      driver_id: cur.driver_id,
    });
  } catch (e) {
    console.error("[booking-edit] log failed", e);
  }
  // Tell the driver when something they act on changed.
  const driverRelevant = changed.some((c) => ["route", "pickup time", "vehicle", "passengers", "suitcases", "hand luggage", "child seat", "notes", "phone", "customer name"].includes(c));
  if (cur.driver_id && driverRelevant && !["completed", "cancelled"].includes(cur.status)) {
    try {
      const origin = (process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin).replace(/\/$/, "");
      await pushToDriver(cur.driver_id, {
        title: `Job ${cur.booking_number} updated`,
        body: `Changed: ${changed.filter((c) => c !== "price" && c !== "email").join(", ")}\n${saved.pickup_address}\n→ ${saved.dropoff_address}`,
        url: `${origin}/driver?job=${cur.id}`,
        tag: `edit-${cur.id}`,
      });
    } catch (e) {
      console.error("[booking-edit] driver push failed", e);
    }
  }

  return NextResponse.json({ ok: true, changed, warnings, booking: saved });
}

function money(n: number) {
  return `£${n.toFixed(2)}`;
}
