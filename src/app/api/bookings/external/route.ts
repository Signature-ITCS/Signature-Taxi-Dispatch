import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidPhone } from "@/lib/format";

/**
 * Record a job that was arranged outside the app.
 *
 * The office takes a call, has no driver free, and books the customer an Uber
 * (or a partner firm) instead. That ride exists nowhere in the system, so the
 * day's takings are short. This puts it back — back-dated, with the fare the
 * customer actually paid and the status it actually ended in.
 *
 * Staff only, and the fare is taken at face value: that is the whole point, and
 * it is why this endpoint can never be reachable by a customer.
 */

const STATUSES = ["pending", "assigned", "in_progress", "completed", "cancelled"] as const;
const METHODS = ["cash", "card"] as const;
const PAY_STATUSES = ["pending", "paid", "refunded"] as const;

type Status = (typeof STATUSES)[number];
type Method = (typeof METHODS)[number];
type PayStatus = (typeof PAY_STATUSES)[number];

export async function POST(req: Request) {
  const me = await getSessionProfile();
  if (!me || (me.role !== "admin" && me.role !== "dispatcher")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }

  const b = await req.json().catch(() => ({}));

  const name = String(b.name ?? "").trim();
  const whatsapp = String(b.whatsapp ?? "").trim();
  const pickup = String(b.pickup ?? "").trim();
  const dropoff = String(b.dropoff ?? "").trim();
  const fare = Number(b.fare);

  if (!name || !whatsapp || !pickup || !dropoff) {
    return NextResponse.json({ ok: false, error: "missing_fields" });
  }
  if (!isValidPhone(whatsapp)) {
    return NextResponse.json({ ok: false, error: "invalid_phone" });
  }
  if (!Number.isFinite(fare) || fare < 0) {
    return NextResponse.json({ ok: false, error: "invalid_fare" });
  }

  // When the ride actually happened. Usually the past — that is the point —
  // but a job booked ahead on someone else's app is legitimate too.
  const occurredAt = b.occurred_at ? new Date(String(b.occurred_at)) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    return NextResponse.json({ ok: false, error: "invalid_date" });
  }

  const status: Status = STATUSES.includes(b.status) ? b.status : "completed";
  const method: Method = METHODS.includes(b.payment_method) ? b.payment_method : "cash";
  // A finished job that was paid for is the common case; anything else is set
  // explicitly rather than guessed at.
  const payStatus: PayStatus = PAY_STATUSES.includes(b.payment_status) ? b.payment_status : "pending";

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ ok: false, error: "no_service_role_key" });
  }

  const { data, error } = await admin.rpc("create_external_booking", {
    p_customer_name: name,
    p_whatsapp: whatsapp,
    p_pickup_address: pickup,
    p_dropoff_address: dropoff,
    p_fare: fare,
    p_occurred_at: occurredAt.toISOString(),
    p_status: status,
    p_payment_method: method,
    p_payment_status: payStatus,
    // A non-null provider is what marks a booking as off-platform. The form
    // no longer asks which service was used — it changed nothing about the
    // money or the accounting — so a constant marker does the job.
    p_provider: "Outside",
    p_email: String(b.email ?? "").trim() || null,
    p_category_id: b.category_id || null,
    p_notes: String(b.notes ?? "").trim() || null,
    p_passengers: Number(b.passengers) > 0 ? Number(b.passengers) : 1,
  });

  if (error) {
    console.error("[external booking] rpc failed", error);
    return NextResponse.json({ ok: false, error: "create_failed", detail: error.message });
  }

  const result = data as { ok: boolean; error?: string; booking_id?: string; booking_number?: string };
  if (!result?.ok) return NextResponse.json(result ?? { ok: false, error: "no_response" });

  await admin.from("activity_logs").insert({
    actor_id: me.id,
    actor_name: me.full_name,
    actor_role: me.role,
    action: "external_booking_added",
    description: `Added outside booking ${result.booking_number} — ${name}, ${fare.toFixed(2)}`,
    metadata: { fare, status, occurred_at: occurredAt.toISOString() },
  });

  return NextResponse.json(result);
}
