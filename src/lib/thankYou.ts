import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailEnabled } from "@/lib/email";
import { rideThankYouEmail } from "@/lib/emailTemplates";

function siteOrigin(fallback?: string): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || fallback || "").replace(/\/$/, "");
}

/**
 * Send the "thanks for riding" email for one completed booking — exactly once.
 *
 * Called the moment a ride turns completed (the database trigger calls
 * /api/webhooks/booking-status) and again by the daily sweep for anything that
 * failed. `thanks_sent_at` is the lock: only the caller that stamps it sends,
 * and a failed send clears it again so the sweep can retry.
 *
 * Outside jobs (Uber, partner firms) are skipped — they are entered by staff
 * after the fact, and the passenger never rode in one of our cars.
 */
export async function sendRideThankYou(bookingId: string, origin?: string): Promise<"sent" | "skipped" | "failed"> {
  if (!(await emailEnabled())) return "skipped";
  const base = siteOrigin(origin);
  if (!base) return "skipped";

  const admin = createAdminClient();
  const { data: claimed } = await admin
    .from("bookings")
    .update({ thanks_sent_at: new Date().toISOString() })
    .eq("id", bookingId)
    .eq("status", "completed")
    .is("thanks_sent_at", null)
    .is("external_provider", null)
    .not("customer_email", "is", null)
    .select("id, booking_number, customer_name, customer_email, pickup_address, dropoff_address")
    .maybeSingle();
  if (!claimed?.customer_email) return "skipped";

  const mail = rideThankYouEmail({
    customerName: claimed.customer_name ?? "",
    bookingNumber: claimed.booking_number,
    pickup: claimed.pickup_address,
    dropoff: claimed.dropoff_address,
    reviewUrl: `${base}/track/${encodeURIComponent(claimed.booking_number)}#review`,
    installUrl: `${base}/install`,
    bookUrl: `${base}/book`,
  });

  const ok = await sendEmail({ to: claimed.customer_email, subject: mail.subject, html: mail.html });
  if (!ok) {
    // Hand it back so the daily sweep tries again.
    await admin.from("bookings").update({ thanks_sent_at: null }).eq("id", bookingId);
    return "failed";
  }
  return "sent";
}

/** Catch-up for rides completed in the last week whose thank-you never went. */
export async function sweepRideThankYous(origin?: string): Promise<number> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const { data } = await admin
    .from("bookings")
    .select("id")
    .eq("status", "completed")
    .is("thanks_sent_at", null)
    .is("external_provider", null)
    .not("customer_email", "is", null)
    .gte("completed_at", since)
    .limit(50);
  let sent = 0;
  for (const b of data ?? []) {
    if ((await sendRideThankYou(b.id, origin)) === "sent") sent++;
  }
  return sent;
}
