import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, webhookSecret, fromMinor } from "@/lib/stripe";
import { tenantDb, type TenantDb } from "@/lib/tenantDb";
import { getCompany } from "@/lib/tenant";
import { alertStaffPayment, sweepUnmatchedPayments } from "@/lib/paymentAlerts";
import { redeemCheckoutSession } from "@/lib/checkoutRedeem";

/**
 * Stripe webhook — the source of truth for what happened to money.
 *
 * The browser telling us "the card went through" is a hint; Stripe telling us is
 * a fact. Without this endpoint a customer whose phone died between paying and
 * the booking being saved is simply charged for nothing, a refund issued from
 * the Stripe Dashboard never reaches our database, and a chargeback arrives
 * silently. Everything here is idempotent: Stripe retries deliveries for days.
 *
 * One endpoint per company: /api/webhooks/stripe/<company id>, shown in that
 * company's Admin → Settings → Card payments. In its Stripe Dashboard →
 * Developers → Webhooks it adds that URL, subscribed to
 * checkout.session.completed, checkout.session.expired,
 * payment_intent.succeeded, payment_intent.payment_failed, charge.refunded,
 * charge.dispute.created, charge.dispute.closed — and saves the signing secret
 * in the same settings card.
 *
 * The company holds its own signing secret, so it could sign events itself.
 * Every handler therefore works through tenantDb(companyId): whatever an event
 * says, it can only ever touch that company's own rows.
 *
 * checkout.session.completed is the important one: it is what turns a paid
 * Checkout into a booking when the customer never makes it back to the site.
 */

type Admin = TenantDb;

export async function POST(req: Request, ctx: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(companyId) || !(await getCompany(companyId))) {
    return NextResponse.json({ ok: false, error: "unknown_company" }, { status: 404 });
  }
  const stripe = await getStripe(companyId);
  const secret = await webhookSecret(companyId);
  if (!stripe || !secret) {
    // Returning 200 would make Stripe think it was delivered and drop it.
    console.error("[stripe-webhook] company", companyId, "has no Stripe key / webhook secret saved");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ ok: false, error: "no_signature" }, { status: 400 });

  // Must be the exact bytes Stripe signed — never req.json().
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
  } catch (err) {
    // Anyone can POST here; only Stripe can sign. This is the door.
    console.error("[stripe-webhook] signature verification failed", err);
    return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 400 });
  }

  const admin = tenantDb(companyId);

  // Exactly-once: the primary key rejects a redelivery of an event we already
  // handled, and we answer 200 so Stripe stops retrying it.
  const { error: dupe } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type });
  if (dupe) {
    if (dupe.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    console.error("[stripe-webhook] could not record event", dupe);
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await onCheckoutCompleted(admin, event.data.object, origin);
        break;
      case "checkout.session.expired":
        await onCheckoutExpired(admin, event.data.object);
        break;
      case "payment_intent.succeeded":
        await onPaymentSucceeded(admin, event.data.object);
        break;
      case "payment_intent.payment_failed":
        await onPaymentFailed(admin, event.data.object);
        break;
      case "charge.refunded":
        await onChargeRefunded(admin, event.data.object);
        break;
      case "charge.dispute.created":
        await onDisputeOpened(admin, event.data.object, origin);
        break;
      case "charge.dispute.closed":
        await onDisputeClosed(admin, event.data.object);
        break;
      default:
        break; // subscribed to more than we handle? fine — just acknowledge.
    }
    await admin
      .from("stripe_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", event.id);
  } catch (err) {
    // Record the failure and return 500 so Stripe retries this event.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stripe-webhook] ${event.type} failed`, err);
    await admin.from("stripe_events").update({ error: message }).eq("id", event.id);
    return NextResponse.json({ ok: false, error: "handler_failed" }, { status: 500 });
  }

  // Opportunistic catch-up: this app has no cron, so every webhook delivery
  // doubles as a chance to chase payments nobody has been told about.
  await sweepUnmatchedPayments(origin);

  return NextResponse.json({ ok: true });
}

/**
 * Does this payment belong to THIS app?
 *
 * One Stripe account can serve several businesses, and a webhook endpoint is
 * sent every event of its type on that account — not only the ones we caused.
 * Without this check another site's takings would land in this app's ledger as
 * "unmatched", and its staff would be emailed about money that was never theirs.
 *
 * Everything we start carries the draft it came from; anything already in our
 * own tables is ours by definition.
 */
async function isOurPayment(
  admin: Admin,
  intentId: string | null | undefined,
  metadata?: Stripe.Metadata | null
): Promise<boolean> {
  if (typeof metadata?.draft_id === "string" && metadata.draft_id.trim()) return true;
  if (!intentId) return false;

  const [draft, payment, booking] = await Promise.all([
    admin.from("checkout_drafts").select("id").eq("payment_intent_id", intentId).maybeSingle(),
    admin.from("payments").select("id").eq("stripe_payment_intent_id", intentId).maybeSingle(),
    admin.from("bookings").select("id").eq("stripe_payment_intent_id", intentId).limit(1).maybeSingle(),
  ]);
  return !!(draft.data || payment.data || booking.data);
}

/* ── handlers ──────────────────────────────────────────────────────────────── */

/**
 * A Checkout payment went through. This is the safety net for the customer who
 * paid and then closed the tab, lost signal, or never came back: the booking
 * gets created here instead, with the same emails and SMS they would have got.
 * Redemption is locked on the draft row, so this and /booking/complete racing
 * each other still produces exactly one booking.
 */
async function onCheckoutCompleted(admin: Admin, session: Stripe.Checkout.Session, origin: string) {
  if (session.payment_status !== "paid") return;
  // Only this company's own checkouts. (Redemption then re-checks the payment
  // with the draft's own Stripe account — the event itself is never trusted.)
  const { data: draft } = await admin.from("checkout_drafts").select("id").eq("session_id", session.id).maybeSingle();
  if (!draft) return;
  const result = await redeemCheckoutSession(session.id, origin);
  // Not an error we can retry out of — a draft that no longer exists stays
  // unmatched, and the payments sweep is what puts it in front of staff.
  if (!result.ok && result.error !== "unknown_session") {
    throw new Error(`checkout redemption failed: ${result.error}`);
  }
}

/** Customer never paid within the window. Tidy the draft away. */
async function onCheckoutExpired(admin: Admin, session: Stripe.Checkout.Session) {
  await admin
    .from("checkout_drafts")
    .update({ status: "expired" })
    .eq("session_id", session.id)
    .is("booking_id", null);
}

/**
 * Money is in. /api/book normally records this within a second or two; when it
 * doesn't (browser closed, network died, our server 500'd) this is the only
 * trace the payment ever existed — so it is written with no booking attached
 * and flagged. The sweep emails staff once the grace period is up, and the row
 * is adopted if the booking turns up late.
 */
async function onPaymentSucceeded(admin: Admin, pi: Stripe.PaymentIntent) {
  const amount = fromMinor(pi.amount_received ?? pi.amount ?? 0);
  if (amount <= 0) return;
  // Another business on the same Stripe account — not our money, not our row.
  if (!(await isOurPayment(admin, pi.id, pi.metadata))) return;

  const { data: existing } = await admin
    .from("payments")
    .select("id, booking_id")
    .eq("stripe_payment_intent_id", pi.id)
    .maybeSingle();

  // Did a booking already claim this intent?
  const { data: booking } = await admin
    .from("bookings")
    .select("id, booking_number, customer_name, customer_email, trip_group_id")
    .eq("stripe_payment_intent_id", pi.id)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Row exists but nothing is attached and a booking has since appeared — link it.
    if (!existing.booking_id && booking?.id) {
      await admin
        .from("payments")
        .update({ booking_id: booking.id, needs_review: false, review_reason: null })
        .eq("id", existing.id);
    }
    return;
  }

  const receiptUrl = await receiptFor(admin.companyId, pi);
  const orphan = !booking?.id;

  const { error } = await admin.from("payments").insert({
    booking_id: booking?.id ?? null,
    amount,
    method: "card",
    status: "paid",
    currency: pi.currency ?? "gbp",
    stripe_payment_intent_id: pi.id,
    receipt_url: receiptUrl,
    needs_review: orphan,
    review_reason: orphan
      ? "Stripe confirmed this payment but no booking was ever saved for it. Refund the customer from the Stripe Dashboard or create the booking by hand."
      : null,
  });
  // 23505 = /api/book inserted it in the meantime. Nothing to do.
  if (error && error.code !== "23505") throw new Error(error.message);

  if (orphan) {
    await admin.from("activity_logs").insert({
      action: "payment_unmatched",
      description: `Card payment of ${amount.toFixed(2)} arrived with no booking (${pi.id})`,
      metadata: { payment_intent: pi.id, amount },
    });
    // The booking request may still be in flight, so the sweep's grace period
    // decides when this becomes an email — nothing is sent from here.
  }
}

/** A declined or abandoned attempt. Useful for support ("my card was refused"). */
async function onPaymentFailed(admin: Admin, pi: Stripe.PaymentIntent) {
  if (!(await isOurPayment(admin, pi.id, pi.metadata))) return;
  const reason = pi.last_payment_error?.message ?? "Payment failed";
  const { data: existing } = await admin
    .from("payments")
    .select("id, status")
    .eq("stripe_payment_intent_id", pi.id)
    .maybeSingle();

  // Never downgrade a payment that already succeeded (a later attempt on the
  // same intent can fail after one succeeded).
  if (existing) {
    if (existing.status === "paid" || existing.status === "refunded") return;
    await admin
      .from("payments")
      .update({ status: "failed", failure_reason: reason })
      .eq("id", existing.id);
    return;
  }

  await admin.from("payments").insert({
    booking_id: null,
    amount: fromMinor(pi.amount ?? 0),
    method: "card",
    status: "failed",
    currency: pi.currency ?? "gbp",
    stripe_payment_intent_id: pi.id,
    failure_reason: reason,
  });
}

/**
 * Refunds issued anywhere — our admin UI, or straight from the Stripe Dashboard.
 * This is what stops a refunded ride from still showing "Paid" to dispatch.
 */
async function onChargeRefunded(admin: Admin, charge: Stripe.Charge) {
  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!piId) return;

  const refunded = fromMinor(charge.amount_refunded ?? 0);
  const total = fromMinor(charge.amount ?? 0);
  const full = refunded >= total - 0.001;

  await admin
    .from("payments")
    .update({
      amount_refunded: refunded,
      ...(full ? { status: "refunded", refunded_at: new Date().toISOString() } : {}),
    })
    .eq("stripe_payment_intent_id", piId);

  if (!full) return; // partial refund leaves the booking paid

  const { data: booking } = await admin
    .from("bookings")
    .select("id, booking_number, trip_group_id")
    .eq("stripe_payment_intent_id", piId)
    .limit(1)
    .maybeSingle();
  if (!booking) return;

  if (booking.trip_group_id) {
    await admin.from("bookings").update({ payment_status: "refunded" }).eq("trip_group_id", booking.trip_group_id);
  } else {
    await admin.from("bookings").update({ payment_status: "refunded" }).eq("id", booking.id);
  }

  await admin.from("activity_logs").insert({
    action: "refund",
    description: `Refund of ${refunded.toFixed(2)} synced from Stripe for ${booking.booking_number}`,
    metadata: { payment_intent: piId, amount: refunded },
  });
}

/** A chargeback. There is a deadline to respond, so this one emails immediately. */
async function onDisputeOpened(admin: Admin, dispute: Stripe.Dispute, origin: string) {
  const piId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
  // A chargeback against another site on this account is their problem to
  // answer, and waking this office at 2am about it helps nobody.
  if (!(await isOurPayment(admin, piId))) return;
  const amount = fromMinor(dispute.amount ?? 0);

  if (piId) {
    await admin
      .from("payments")
      .update({
        disputed_at: new Date().toISOString(),
        needs_review: true,
        review_reason: `Chargeback opened with the customer's bank (${dispute.reason}). Respond in the Stripe Dashboard before the deadline.`,
        alerted_at: new Date().toISOString(),
      })
      .eq("stripe_payment_intent_id", piId);
  }

  const { data: booking } = piId
    ? await admin
        .from("bookings")
        .select("booking_number, customer_name, customer_email")
        .eq("stripe_payment_intent_id", piId)
        .limit(1)
        .maybeSingle()
    : { data: null };

  await admin.from("activity_logs").insert({
    action: "payment_disputed",
    description: `Chargeback opened for ${amount.toFixed(2)} (${dispute.reason})`,
    metadata: { payment_intent: piId ?? null, amount, reason: dispute.reason },
  });

  await alertStaffPayment(
    admin.companyId,
    {
      kind: "dispute",
      amount,
      paymentIntentId: piId ?? dispute.id,
      reason: `Reason given: ${dispute.reason}. Evidence is due by the date shown in the Stripe Dashboard.`,
      bookingNumber: booking?.booking_number ?? null,
      customerName: booking?.customer_name ?? null,
      customerEmail: booking?.customer_email ?? null,
    },
    origin
  );
}

/** Dispute resolved — clear the flag if we won, keep it if the money went. */
async function onDisputeClosed(admin: Admin, dispute: Stripe.Dispute) {
  const piId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
  if (!piId) return;
  const won = dispute.status === "won";
  await admin
    .from("payments")
    .update({
      needs_review: !won,
      review_reason: won
        ? null
        : `Chargeback ${dispute.status} — the money has been taken back by the customer's bank.`,
    })
    .eq("stripe_payment_intent_id", piId);
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

/** The Stripe-hosted receipt, fetched only when the event didn't carry it. */
async function receiptFor(companyId: string, pi: Stripe.PaymentIntent): Promise<string | null> {
  const charge = pi.latest_charge;
  if (charge && typeof charge === "object") return charge.receipt_url ?? null;
  if (typeof charge !== "string") return null;
  try {
    const stripe = await getStripe(companyId);
    if (!stripe) return null;
    const c = await stripe.charges.retrieve(charge);
    return c.receipt_url ?? null;
  } catch {
    return null;
  }
}
