import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sweepRideThankYous } from "@/lib/thankYou";
import { runNightlyBackups } from "@/lib/backups";

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

  return NextResponse.json({ ok: true, at: new Date().toISOString(), thanked, backups });
}
