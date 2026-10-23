import { NextResponse } from "next/server";
import { handleBookingChange } from "@/lib/bookingEvents";
import { rateLimit, clientIp } from "@/lib/rateLimit";

/**
 * Called by the database whenever a booking is assigned, the driver arrives,
 * or the ride is completed — from the admin panel, the dispatch board or the
 * driver app alike (trigger notify_booking_change, db/2026-10-13_driver_app.sql).
 *
 * The body only names a booking. Nothing is taken on trust: handleBookingChange
 * re-reads it and only sends what its real state makes due, once each, so a
 * forged call can at most send a message that was due anyway.
 */
export async function POST(req: Request) {
  if (!rateLimit(`booking-status:${clientIp(req)}`, 240, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const { booking_id } = (await req.json().catch(() => ({}))) as { booking_id?: unknown };
  if (typeof booking_id !== "string" || !UUID.test(booking_id)) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  const sent = await handleBookingChange(booking_id, origin);
  return NextResponse.json({ ok: true, sent });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
