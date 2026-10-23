import { createAdminClient } from "@/lib/supabase/admin";
import { sendSms, smsEnabled } from "@/lib/sms";
import { pushToDriver } from "@/lib/push";
import { sendRideThankYou } from "@/lib/thankYou";
import { getCompanyBrand } from "@/lib/companyBrand";

function siteOrigin(fallback?: string): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || fallback || "").replace(/\/$/, "");
}

type Admin = ReturnType<typeof createAdminClient>;

interface BookingRow {
  id: string;
  company_id: string;
  booking_number: string;
  status: string;
  driver_id: string | null;
  notified_driver_id: string | null;
  customer_whatsapp: string | null;
  pickup_address: string;
  dropoff_address: string;
  scheduled_at: string | null;
  external_provider: string | null;
  external_driver_name: string | null;
  external_vehicle_color: string | null;
  external_vehicle_make: string | null;
  external_vehicle_model: string | null;
  external_vehicle_plate: string | null;
}

/**
 * Everything that is due because a booking changed — called by the database
 * trigger (via /api/webhooks/booking-status) whenever a job is assigned, the
 * driver arrives, or the ride is completed.
 *
 * Nothing here trusts the caller: it re-reads the booking and only acts on its
 * real state, and each message is "claimed" by stamping the booking before it
 * is sent, so however many times this runs, each goes out once.
 */
export async function handleBookingChange(bookingId: string, origin?: string): Promise<string[]> {
  const base = siteOrigin(origin);
  const admin = createAdminClient();
  const { data } = await admin
    .from("bookings")
    .select(
      "id, company_id, booking_number, status, driver_id, notified_driver_id, customer_whatsapp, pickup_address, dropoff_address, scheduled_at, external_provider, external_driver_name, external_vehicle_color, external_vehicle_make, external_vehicle_model, external_vehicle_plate"
    )
    .eq("id", bookingId)
    .maybeSingle();
  const b = data as BookingRow | null;
  if (!b) return [];

  const done: string[] = [];
  if (b.driver_id && ["assigned", "accepted"].includes(b.status) && b.notified_driver_id !== b.driver_id) {
    if (await notifyDriverOfJob(admin, b, base)) done.push("driver_push");
  }
  if (b.status === "driver_arrived" && !b.external_provider) {
    if (await textCustomerArrived(admin, b)) done.push("arrived_sms");
  }
  if (b.status === "completed" && !b.external_provider) {
    if (await textCustomerCompleted(admin, b, base)) done.push("completed_sms");
    if ((await sendRideThankYou(b.id, base)) === "sent") done.push("thank_you_email");
  }
  return done;
}

/** "New job" push to the assigned driver's phone(s). */
async function notifyDriverOfJob(admin: Admin, b: BookingRow, base: string): Promise<boolean> {
  const driverId = b.driver_id!;
  // Claim: only if this driver hasn't been told about this job yet.
  const { data: claimed } = await admin
    .from("bookings")
    .update({ notified_driver_id: driverId })
    .eq("id", b.id)
    .eq("driver_id", driverId)
    .or(`notified_driver_id.is.null,notified_driver_id.neq.${driverId}`)
    .select("id")
    .maybeSingle();
  if (!claimed) return false;

  const when = b.scheduled_at
    ? new Date(b.scheduled_at).toLocaleString("en-GB", {
        timeZone: "Europe/London",
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "ASAP";
  const sent = await pushToDriver(driverId, {
    title: `New job · ${when}`,
    body: `Pick-up: ${b.pickup_address}\nDrop-off: ${b.dropoff_address}`,
    url: `${base}/driver?job=${b.id}`,
    tag: `job-${b.id}`,
  });
  return sent > 0;
}

/** "Your driver has arrived" text to the customer. */
async function textCustomerArrived(admin: Admin, b: BookingRow): Promise<boolean> {
  if (!b.customer_whatsapp || !(await smsEnabled(b.company_id))) return false;
  const { data: claimed } = await admin
    .from("bookings")
    .update({ arrived_sms_at: new Date().toISOString() })
    .eq("id", b.id)
    .eq("status", "driver_arrived")
    .is("arrived_sms_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return false;

  const { name, car } = await driverAndCar(admin, b);
  const brand = await getCompanyBrand(b.company_id);
  const msg =
    `${brand.name}: Your driver${name ? ` ${name}` : ""} has arrived` +
    `${car ? ` in a ${car}` : ""} and is waiting for you. Ref ${b.booking_number}.`;
  const ok = await sendSms(b.company_id, b.customer_whatsapp, msg);
  if (!ok) await admin.from("bookings").update({ arrived_sms_at: null }).eq("id", b.id);
  return ok;
}

/** "Ride complete — thanks" text to the customer, with the review link. */
async function textCustomerCompleted(admin: Admin, b: BookingRow, base: string): Promise<boolean> {
  if (!b.customer_whatsapp || !base || !(await smsEnabled(b.company_id))) return false;
  const { data: claimed } = await admin
    .from("bookings")
    .update({ completed_sms_at: new Date().toISOString() })
    .eq("id", b.id)
    .eq("status", "completed")
    .is("completed_sms_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return false;

  const brand = await getCompanyBrand(b.company_id);
  const msg =
    `${brand.name}: Your ride ${b.booking_number} is complete. Thanks for travelling with us! ` +
    `Rate your ride: ${base}/track/${encodeURIComponent(b.booking_number)}#review`;
  const ok = await sendSms(b.company_id, b.customer_whatsapp, msg);
  if (!ok) await admin.from("bookings").update({ completed_sms_at: null }).eq("id", b.id);
  return ok;
}

/** Driver's first name and "silver Toyota Prius (AB12 CDE)", ours or an outside driver's. */
async function driverAndCar(admin: Admin, b: BookingRow): Promise<{ name: string | null; car: string | null }> {
  const describe = (color?: string | null, make?: string | null, model?: string | null, plate?: string | null) => {
    const car = [color, make, model].map((p) => p?.trim()).filter(Boolean).join(" ");
    return car ? `${car}${plate ? ` (${plate})` : ""}` : plate ? `car ${plate}` : null;
  };
  if (b.driver_id) {
    const [{ data: d }, { data: v }] = await Promise.all([
      admin.from("drivers").select("full_name").eq("id", b.driver_id).maybeSingle(),
      admin.from("vehicles").select("color, make, model, license_plate").eq("driver_id", b.driver_id).limit(1).maybeSingle(),
    ]);
    return {
      name: d?.full_name?.split(" ")[0] ?? null,
      car: v ? describe(v.color, v.make, v.model, v.license_plate) : null,
    };
  }
  return {
    name: b.external_driver_name?.split(" ")[0] ?? null,
    car: describe(b.external_vehicle_color, b.external_vehicle_make, b.external_vehicle_model, b.external_vehicle_plate),
  };
}
