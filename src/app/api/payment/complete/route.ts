import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { redeemCheckoutSession } from "@/lib/checkoutRedeem";
import { rateLimit, clientIp } from "@/lib/rateLimit";

/**
 * Called by /booking/complete when the customer returns from Stripe.
 *
 * Verifies the session really was paid, then creates the booking. Safe to call
 * repeatedly — the draft row makes redemption happen exactly once, so a refresh
 * or a slow connection can't produce two bookings.
 */
export async function POST(req: Request) {
  if (!rateLimit(`complete:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const stripe = await getStripe();
  if (!stripe) return NextResponse.json({ ok: false, error: "payments_not_configured" });

  const { session_id } = await req.json().catch(() => ({}));
  if (!session_id || typeof session_id !== "string") {
    return NextResponse.json({ ok: false, error: "missing_session" });
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  const result = await redeemCheckoutSession(stripe, session_id, origin);
  return NextResponse.json(result);
}
