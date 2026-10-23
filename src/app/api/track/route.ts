import { NextResponse } from "next/server";
import { callRpc } from "@/lib/supabaseRest";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, clientIp } from "@/lib/rateLimit";

interface RideStatus {
  ok?: boolean;
  driver?: {
    name: string;
    phone: string | null;
    rating: number | null;
    vehicle: string | null;
    plate: string | null;
    external?: boolean;
  } | null;
  [k: string]: unknown;
}

export async function POST(req: Request) {
  if (!rateLimit(`track:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const b = await req.json().catch(() => ({}));
  if (!b.ref) return NextResponse.json({ ok: false, error: "missing_ref" });

  const ref = String(b.ref).trim();
  const { data } = await callRpc<RideStatus>("get_ride_status", { p_booking_number: ref });
  if (!data) return NextResponse.json({ ok: false, error: "no_response" });

  // Jobs handed to an outside driver have no `drivers` row, so get_ride_status
  // returns no driver at all. Fill it in from the booking so the customer still
  // sees who is coming, in what car, and can ring them.
  if (data.ok && !data.driver) {
    try {
      const admin = createAdminClient();
      const { data: booking } = await admin
        .from("bookings")
        .select(
          "external_driver_name, external_driver_phone, external_vehicle_category_id, external_vehicle_make, external_vehicle_model, external_vehicle_color, external_vehicle_plate"
        )
        .eq("booking_number", ref)
        .maybeSingle();

      if (booking?.external_driver_name) {
        let vehicle = [
          booking.external_vehicle_color,
          booking.external_vehicle_make,
          booking.external_vehicle_model,
        ]
          .map((p) => (p ?? "").trim())
          .filter(Boolean)
          .join(" ");

        // Nothing specific typed in — fall back to the class of car ("Saloon").
        if (!vehicle && booking.external_vehicle_category_id) {
          const { data: cat } = await admin
            .from("vehicle_categories")
            .select("name")
            .eq("id", booking.external_vehicle_category_id)
            .maybeSingle();
          vehicle = cat?.name ?? "";
        }

        data.driver = {
          name: booking.external_driver_name,
          phone: booking.external_driver_phone ?? null,
          // No rating: they are not our driver, and inventing a 5-star rating
          // for a stranger would be a lie to the customer.
          rating: null,
          vehicle: vehicle || null,
          plate: booking.external_vehicle_plate ?? null,
          external: true,
        };
      }
    } catch {
      /* tracking must still work if the lookup fails */
    }
  }

  return NextResponse.json(data);
}
