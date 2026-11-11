import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tenantDb } from "@/lib/tenantDb";
import { getOfficeContext, websiteForRequest } from "@/lib/tenant";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { splitFare } from "@/lib/fare";
import {
  normalizeBookingInput,
  validateBookingInput,
  categoryBookable,
  createTrip,
  notifyBooking,
  type BookingInput,
} from "@/lib/bookingFlow";

/**
 * Create a booking that is NOT paid by card up front — cash rides, and staff
 * bookings taken over the phone.
 *
 * Card bookings do not come through here any more. They go to Stripe Checkout
 * (/api/payment/checkout) and the booking is written on the way back, once
 * Stripe confirms the money — see src/lib/checkoutRedeem.ts.
 *
 * Every refused booking is written to the server log, and — when staff were
 * booking — to their company's Activity Logs ("Booking failed: <reason>"), so
 * "it said booking failed" can always be looked up afterwards.
 */
export async function POST(req: Request) {
  const copy = req.clone();
  const res = await book(req);
  let out: { ok?: boolean; error?: string; detail?: string; outbound?: { ok?: boolean; error?: string } } | null = null;
  try {
    out = await res.clone().json();
  } catch {
    out = null;
  }
  if (!out?.ok || out.outbound?.ok === false) {
    const reason = out?.error ?? out?.outbound?.error ?? `http_${res.status}`;
    const b = (await copy.json().catch(() => ({}))) as Partial<BookingInput>;
    const where = `${b.outbound?.pickup_address ?? "?"} → ${b.outbound?.dropoff_address ?? "?"}`;
    console.error("[book] refused:", reason, out?.detail ?? "", "|", where);
    try {
      const office = await getOfficeContext();
      if (office) {
        await tenantDb(office.company.id).from("activity_logs").insert({
          actor_id: office.profile.id,
          actor_name: office.profile.full_name,
          actor_role: office.profile.role,
          action: "booking_failed",
          description: `Booking failed: ${reason}${out?.detail ? ` (${out.detail})` : ""} · ${b.whatsapp ?? "no phone"} · ${where}${
            b.outbound?.scheduled_at ? ` · pickup ${b.outbound.scheduled_at}` : " · ASAP"
          }`.slice(0, 500),
        });
      }
    } catch (e) {
      console.error("[book] could not log the failure", e);
    }
  }
  return res;
}

async function book(req: Request): Promise<Response> {
  // Throttle: booking sends an SMS + emails to client-supplied addresses and hits
  // Google — cap per IP so it can't be scripted to bomb numbers or run up bills.
  if (!rateLimit(`book:${clientIp(req)}`, 15, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const b = (await req.json().catch(() => ({}))) as Partial<BookingInput> & { custom_fare?: unknown };

  // Resolved once: it decides which company this is for, who may book a card
  // ride, and whose hand-typed distance we are willing to believe. Staff always
  // book into their own company.
  const office = await getOfficeContext();
  const isStaff = !!office;
  const site = await websiteForRequest(b.site, office?.company.id ?? null);
  if (!site) return NextResponse.json({ ok: false, error: "invalid_website" });
  const companyId = site.company_id;

  await normalizeBookingInput(b, companyId);
  const invalid = validateBookingInput(b);
  if (invalid) return NextResponse.json({ ok: false, error: invalid });

  const input = b as BookingInput;
  if (!(await categoryBookable(input.category_id, companyId))) {
    return NextResponse.json({ ok: false, error: "category_unavailable" });
  }

  // A card ride must be paid before it exists. Refusing here stops a crafted
  // request from booking a card trip for free.
  if (input.payment_method === "card" && !isStaff) {
    return NextResponse.json({ ok: false, error: "use_checkout" });
  }

  // Only staff may book without coordinates (a phone booking with a typed
  // address). For the public, no coordinates means no price — see
  // resolveLegDistance().
  const created = await createTrip(input, site, { trustClient: isStaff });
  if ("error" in created) {
    // The database answers { ok:false, error:"…" }; anything else (e.g. a server
    // error) still gets a reason, so it shows on screen and in the log.
    const e = created.error as { error?: string; message?: string; code?: string } | null;
    return NextResponse.json({
      ok: false,
      error: e?.error ?? "server_error",
      ...(e?.error ? {} : { detail: e?.message ?? e?.code ?? "no response" }),
    });
  }

  // Staff-only manual price override (discount / rush pricing). Verified against
  // the logged-in staff session, so a public customer can NEVER set their own price.
  let overrideFare: number | null = null;
  const requestedFare = Number(b.custom_fare);
  const outboundId = created.outbound.booking_id;
  if (b.custom_fare != null && Number.isFinite(requestedFare) && requestedFare >= 0 && outboundId) {
    if (isStaff) {
      // Whole pounds, like every fare.
      overrideFare = Math.round(requestedFare);
      const admin = createAdminClient();
      const returnId = created.return?.ok ? created.return.booking_id : null;
      if (returnId) {
        // The custom price is the WHOLE-TRIP total. Split it across both legs so the
        // per-leg fares still sum to it (cash collection, settlement, analytics all
        // read per-leg estimated_fare). Split in proportion to the original leg fares.
        const { out: outShare, ret: retShare } = splitFare(
          overrideFare,
          created.outbound.estimated_fare ?? 0,
          created.return?.estimated_fare ?? 0
        );
        await admin
          .from("bookings")
          .update({
            estimated_fare: outShare,
            fare_breakdown: {
              total: outShare,
              custom: true,
              custom_trip_total: overrideFare,
              note: "Custom price set by staff (outbound share)",
            },
          })
          .eq("id", outboundId)
          .eq("company_id", companyId);
        await admin
          .from("bookings")
          .update({
            estimated_fare: retShare,
            fare_breakdown: {
              total: retShare,
              custom: true,
              custom_trip_total: overrideFare,
              note: "Custom price set by staff (return share)",
            },
          })
          .eq("id", returnId)
          .eq("company_id", companyId);
      } else {
        await admin
          .from("bookings")
          .update({
            estimated_fare: overrideFare,
            fare_breakdown: { total: overrideFare, custom: true, note: "Custom price set by staff" },
          })
          .eq("id", outboundId)
          .eq("company_id", companyId);
      }
    }
  }

  const totalFare = overrideFare ?? created.total;
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;

  await notifyBooking({ companyId, input, trip: created, totalFare, paid: false, origin });

  return NextResponse.json({
    ok: true,
    outbound: created.outbound,
    return: created.return,
    paid: false,
    fare: totalFare,
  });
}
