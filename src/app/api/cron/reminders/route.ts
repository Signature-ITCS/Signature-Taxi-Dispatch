import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushToDriver } from "@/lib/push";
import { sendEmail, emailEnabled } from "@/lib/email";
import { staffAlertRecipients } from "@/lib/notifyStaff";
import { upcomingReminderEmail, type ReminderJob } from "@/lib/emailTemplates";
import { rateLimit, clientIp } from "@/lib/rateLimit";

/**
 * One-hour pickup reminders. Called every 5 minutes by the database scheduler
 * (pg_cron job "booking-reminders", db/2026-10-15_reminders.sql).
 *
 * Finds pre-booked journeys starting within the next hour that haven't been
 * reminded yet, stamps each one (so it is reminded exactly once), then pushes
 * the driver and emails staff. Nothing is taken from the caller, so a stray or
 * forged call can at most send a reminder that was due anyway.
 */
const WINDOW_MIN = 62; // a little over the hour: the job runs every 5 minutes

export async function POST(req: Request) {
  if (!rateLimit(`reminders:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin).replace(/\/$/, "");
  const admin = createAdminClient();
  const now = new Date();
  const until = new Date(now.getTime() + WINDOW_MIN * 60_000);

  const { data: due } = await admin
    .from("bookings")
    .select("id, booking_number, scheduled_at, created_at, status, driver_id, customer_name, customer_whatsapp, pickup_address, dropoff_address, driver:drivers(full_name)")
    .is("reminder_sent_at", null)
    .in("status", ["pending", "assigned", "accepted"])
    .gt("scheduled_at", now.toISOString())
    .lte("scheduled_at", until.toISOString())
    .limit(100);

  type Row = {
    id: string;
    booking_number: string;
    scheduled_at: string;
    created_at: string;
    status: string;
    driver_id: string | null;
    customer_name: string;
    customer_whatsapp: string | null;
    pickup_address: string;
    dropoff_address: string;
    driver: { full_name: string } | null;
  };

  const sent: Row[] = [];
  for (const b of (due as unknown as Row[]) ?? []) {
    // Booked less than an hour ahead? The office has only just seen it — no reminder.
    if (new Date(b.scheduled_at).getTime() - new Date(b.created_at).getTime() < 60 * 60_000) continue;
    const { data: claimed } = await admin
      .from("bookings")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", b.id)
      .is("reminder_sent_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    sent.push(b);

    if (b.driver_id) {
      const at = new Date(b.scheduled_at).toLocaleTimeString("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        minute: "2-digit",
      });
      await pushToDriver(b.driver_id, {
        title: `Pickup at ${at} — in 1 hour`,
        body: `${b.pickup_address}\n→ ${b.dropoff_address}${b.status === "assigned" ? "\nPlease accept the job." : ""}`,
        url: `${origin}/driver?job=${b.id}`,
        tag: `reminder-${b.id}`,
      });
    }
  }

  // The bell in the admin / dispatch screens.
  if (sent.length) {
    await admin.from("staff_notifications").insert(
      sent.map((b) => {
        const at = new Date(b.scheduled_at).toLocaleTimeString("en-GB", {
          timeZone: "Europe/London",
          hour: "2-digit",
          minute: "2-digit",
        });
        const noDriver = !b.driver_id;
        return {
          kind: "reminder",
          severity: noDriver ? "urgent" : b.status === "accepted" ? "info" : "warn",
          title: `Pickup at ${at} · ${b.booking_number}${noDriver ? " — NO DRIVER" : b.status === "accepted" ? "" : " — not accepted yet"}`,
          body: `${b.pickup_address} → ${b.dropoff_address}${b.driver?.full_name ? ` · ${b.driver.full_name}` : ""}`,
          booking_id: b.id,
          driver_id: b.driver_id,
        };
      })
    );
  }

  if (sent.length && (await emailEnabled())) {
    const to = await staffAlertRecipients();
    if (to.length) {
      const jobs: ReminderJob[] = sent.map((b) => ({
        bookingNumber: b.booking_number,
        scheduledAt: b.scheduled_at,
        customerName: b.customer_name,
        pickup: b.pickup_address,
        dropoff: b.dropoff_address,
        driverName: b.driver?.full_name ?? null,
        accepted: b.status === "accepted",
      }));
      const mail = upcomingReminderEmail(jobs, `${origin}/dispatch`);
      await sendEmail({ to, subject: mail.subject, html: mail.html });
    }
  }

  return NextResponse.json({ ok: true, reminded: sent.map((b) => b.booking_number) });
}
