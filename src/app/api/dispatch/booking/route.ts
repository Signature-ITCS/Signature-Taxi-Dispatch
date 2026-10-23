import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/auth";
import { callRpc } from "@/lib/supabaseRest";
import { isValidPhone } from "@/lib/format";

const WIDGET_KEY = process.env.WIDGET_API_KEY!;

/** Staff-only: create a manual (phone/office) booking via the tested create_booking RPC. */
export async function POST(req: Request) {
  const me = await getSessionProfile();
  if (!me || (me.role !== "dispatcher" && me.role !== "admin")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  if (!b.name?.trim() || !b.whatsapp?.trim() || !b.category_id) {
    return NextResponse.json({ ok: false, error: "missing_fields" });
  }
  if (!isValidPhone(b.whatsapp)) {
    return NextResponse.json({ ok: false, error: "invalid_phone" });
  }
  const { data } = await callRpc("create_booking", {
    p_api_key: WIDGET_KEY,
    p_customer_name: b.name,
    p_whatsapp: b.whatsapp,
    p_pickup_address: b.pickup,
    p_dropoff_address: b.dropoff,
    p_category_id: b.category_id,
    p_distance_km: b.distance_km ?? 0,
    p_duration_min: b.duration_min ?? 0,
    p_payment_method: b.payment_method ?? "cash",
    p_notes: b.notes ?? "Phone booking",
  });
  return NextResponse.json(data ?? { ok: false, error: "no_response" });
}
