import { NextResponse } from "next/server";
import { callRpc } from "@/lib/supabaseRest";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export async function POST(req: Request) {
  if (!rateLimit(`rate:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const b = await req.json().catch(() => ({}));
  if (!b.ref || !b.rating) return NextResponse.json({ ok: false, error: "missing_fields" });
  const rating = Number(b.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ ok: false, error: "invalid_rating" });
  }
  const { data } = await callRpc("submit_rating", {
    p_booking_number: String(b.ref).trim(),
    p_rating: rating,
    p_comment: b.comment ?? null,
  });
  return NextResponse.json(data ?? { ok: false, error: "no_response" });
}
