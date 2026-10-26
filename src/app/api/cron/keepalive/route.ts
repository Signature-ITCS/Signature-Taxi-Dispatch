import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sweepRideThankYous } from "@/lib/thankYou";
import { runNightlyBackups } from "@/lib/backups";
import { generateInvoices } from "@/lib/billing";
import { notifyOwner, siteOrigin } from "@/lib/provision";

// Exports every company's backup — give it the longest run a plan allows.
export const maxDuration = 60;

/**
 * Daily keep-alive, called by the Vercel cron in vercel.json.
 *
 * Supabase pauses free-tier projects after a week without activity, which
 * takes the booking form and dispatch board down with it. One one-row read a
 * day is enough to keep the project awake and costs next to nothing.
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron calls when that
 * env var is set. Without it this route refuses everyone, so it can't be used
 * to hammer the database from outside.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { error } = await createAdminClient().from("plans").select("id").limit(1);
  if (error) {
    console.error("[keepalive] supabase ping failed", error);
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 500 });
  }

  // Once a day is also a good moment to retry thank-you emails that failed.
  const thanked = await sweepRideThankYous(new URL(req.url).origin).catch(() => 0);

  // And each company's nightly backup (kept 30 days).
  const backups = await runNightlyBackups().catch((err) => {
    console.error("[keepalive] backups failed", err);
    return { done: 0, failed: -1 };
  });

  // Subscription invoices due in the coming week, and a reminder to the owner
  // of the ones still to send / overdue (Master → Billing).
  const invoices = await billingDigest(siteOrigin(new URL(req.url).origin)).catch((err) => {
    console.error("[keepalive] billing failed", err);
    return { created: -1 };
  });

  return NextResponse.json({ ok: true, at: new Date().toISOString(), thanked, backups, invoices });
}

async function billingDigest(origin: string) {
  const created = await generateInvoices(7);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const { data } = await createAdminClient()
    .from("platform_invoices")
    .select("status, due_date, amount, companies(name)")
    .in("status", ["upcoming", "sent"]);
  const rows = (data ?? []) as unknown as { status: string; due_date: string; amount: number; companies: { name: string } | null }[];
  const toSend = rows.filter((r) => r.status === "upcoming");
  const overdue = rows.filter((r) => r.due_date < today);
  if (toSend.length || overdue.length) {
    const list = (xs: typeof rows) => xs.map((r) => `${r.companies?.name ?? "?"} £${Number(r.amount).toFixed(2)}`).join(", ") || "none";
    await notifyOwner(
      `Billing: ${toSend.length} payment link${toSend.length === 1 ? "" : "s"} to send, ${overdue.length} overdue`,
      [
        ["To send", list(toSend)],
        ["Overdue", list(overdue)],
      ],
      `${origin}/master/billing`
    );
  }
  return { created, to_send: toSend.length, overdue: overdue.length };
}
