import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getStripe, toMinor } from "@/lib/stripe";
import { getWebsiteKey } from "@/lib/getWebsiteKey";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceTrip } from "@/lib/pricing";
import { quoteSignature } from "@/lib/quoteSignature";
import { normalizeBookingInput, validateBookingInput, categoryBookable, type BookingInput } from "@/lib/bookingFlow";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { cardPaymentsEnabled } from "@/lib/paymentMethods";
import { draftCookieValue } from "@/lib/draftCookie";

/**
 * Start a Stripe Checkout payment.
 *
 * The booking is deliberately NOT created here. The trip is priced server-side,
 * parked in `checkout_drafts`, and the customer is sent to Stripe's own hosted
 * page. Only once Stripe confirms the money does the draft become a booking —
 * so an abandoned checkout leaves nothing on the dispatch board.
 */
export async function POST(req: Request) {
  // Each call prices the trip (Google Directions) and opens a live Stripe
  // session — cap per IP so it can't be scripted to run up bills.
  if (!rateLimit(`checkout:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  // A hidden button is not a rule — refuse here too, or a crafted request could
  // still start a checkout the site is deliberately not offering.
  if (!cardPaymentsEnabled()) {
    return NextResponse.json({ ok: false, error: "card_disabled" });
  }

  const stripe = await getStripe();
  if (!stripe) return NextResponse.json({ ok: false, error: "payments_not_configured" });

  const b = (await req.json().catch(() => ({}))) as Partial<BookingInput>;

  // Validate the FULL booking now, not after payment: taking money for a trip
  // we would then refuse to save is the one outcome worth engineering against.
  await normalizeBookingInput(b);
  const invalid = validateBookingInput(b);
  if (invalid) return NextResponse.json({ ok: false, error: invalid });
  if (!(await categoryBookable(b.category_id as string))) {
    return NextResponse.json({ ok: false, error: "category_unavailable" });
  }

  const site = b.site ?? "main";
  const apiKey = await getWebsiteKey(site);
  if (!apiKey) return NextResponse.json({ ok: false, error: "invalid_website" });

  const input = b as BookingInput;
  const total = await priceTrip(apiKey, {
    category_id: input.category_id,
    child_seat: input.child_seat,
    outbound: input.outbound,
    return: input.return ?? null,
  });
  if (total == null) return NextResponse.json({ ok: false, error: "quote_failed" });

  const amount = toMinor(total);
  if (amount < 30) return NextResponse.json({ ok: false, error: "amount_too_low" });

  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  // Generated up front so the cancel_url can point back at this exact draft and
  // refill the form the customer already typed.
  const draftId = randomUUID();
  const sig = quoteSignature({
    site,
    category_id: input.category_id,
    child_seat: !!input.child_seat,
    outbound: input.outbound,
    return: input.return ?? null,
  });

  const journey = `${input.outbound.pickup_address} → ${input.outbound.dropoff_address}`;
  const when = input.outbound.scheduled_at
    ? new Date(input.outbound.scheduled_at).toLocaleString("en-GB", {
        timeZone: "Europe/London",
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "As soon as possible";

  const admin = createAdminClient();

  // Pressing "Pay" again for the same trip — after backing out of Stripe, or on
  // a second tab — must land on the SAME checkout, not open a new one. (It also
  // avoids a Stripe idempotency clash: the same key with a fresh draft id in the
  // body is rejected outright, which used to break the whole resume flow.)
  const { data: reusable } = await admin
    .from("checkout_drafts")
    .select("id, session_id")
    .eq("quote_sig", sig)
    .eq("status", "open")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reusable) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(reusable.session_id);
      if (existing.status === "open" && existing.url) {
        const res = NextResponse.json({ ok: true, url: existing.url, draft_id: reusable.id, amount: total });
        res.headers.set("Set-Cookie", draftCookieValue(req, reusable.id));
        return res;
      }
    } catch {
      /* gone or expired at Stripe's end — fall through and open a fresh one */
    }
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        // "Book" instead of "Pay" on the button — it is a ride, not a product.
        submit_type: "book",
        locale: "en-GB",
        customer_email: input.email ?? undefined,
        client_reference_id: draftId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "gbp",
              unit_amount: amount,
              product_data: {
                name: input.return ? "Taxi booking (return)" : "Taxi booking",
                // Stripe caps this; the journey is the part worth showing.
                description: `${journey} · ${when}`.slice(0, 500),
              },
            },
          },
        ],
        success_url: `${origin}/booking/complete?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/book?resume=${draftId}`,
        // Stripe's minimum window is 30 minutes; the draft expires alongside it.
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
        metadata: { draft_id: draftId, site, category_id: input.category_id, quote_sig: sig },
        payment_intent_data: {
          description: `Taxi booking — ${journey}`.slice(0, 1000),
          metadata: { draft_id: draftId, site, category_id: input.category_id, quote_sig: sig },
        },
      },
      // Keyed on this draft so our own retry of the same request is safe. The
      // "same trip twice" case is handled by the reuse lookup above, not here —
      // keying on the trip would make every new draft collide.
      { idempotencyKey: `checkout:${draftId}` }
    );
  } catch (err) {
    console.error("[checkout] session create failed", err);
    return NextResponse.json({ ok: false, error: "stripe_error" });
  }

  // Park the trip. If this fails the customer could pay for something we can
  // never turn into a booking — so cancel the session rather than risk it.
  const { error } = await admin.from("checkout_drafts").insert({
    id: draftId,
    session_id: session.id,
    payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
    payload: input,
    amount: total,
    currency: "gbp",
    website_slug: site,
    customer_email: input.email ?? null,
    quote_sig: sig,
    status: "open",
  });

  if (error) {
    console.error("[checkout] could not save draft — expiring session", error);
    try {
      await stripe.checkout.sessions.expire(session.id);
    } catch {
      /* best effort; the session expires on its own in 30 minutes anyway */
    }
    return NextResponse.json({ ok: false, error: "draft_failed" });
  }

  const res = NextResponse.json({ ok: true, url: session.url, draft_id: draftId, amount: total });
  // Marks this browser as the owner, so only it can read the trip back.
  res.headers.set("Set-Cookie", draftCookieValue(req, draftId));
  return res;
}
