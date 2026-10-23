import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Web Push to the driver app — the "new job" alert that arrives even when the
 * app is closed. Keys (VAPID) live in the environment:
 *
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY  shared with the browser to subscribe
 *   VAPID_PRIVATE_KEY             secret, signs every push
 *   VAPID_SUBJECT                 contact for the push services, mailto:…
 */
export function pushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let ready = false;
function init(): boolean {
  if (ready) return true;
  if (!pushConfigured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  ready = true;
  return true;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Page the notification opens when tapped. */
  url: string;
  /** Same tag replaces an older notification instead of stacking. */
  tag?: string;
}

/** Push to every device a driver has signed in on. Returns how many got it. */
export async function pushToDriver(driverId: string, msg: PushMessage): Promise<number> {
  if (!init()) return 0;
  const admin = createAdminClient();
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("driver_id", driverId);

  let delivered = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(msg),
        // A job alert is useless an hour later; urgent so phones wake for it.
        { TTL: 60 * 30, urgency: "high" }
      );
      delivered++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // 404/410: the phone unsubscribed or the app was removed — forget it.
      if (status === 404 || status === 410) {
        await admin.from("push_subscriptions").delete().eq("id", s.id);
      } else {
        console.error("[push] send failed", status, (err as Error).message);
      }
    }
  }
  return delivered;
}
