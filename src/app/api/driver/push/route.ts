import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The driver app registers (POST) or removes (DELETE) this device for "new
 * job" push notifications. Only a signed-in driver can, and only for themself.
 */
async function currentDriverId(): Promise<string | null> {
  const supa = await createClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return null;
  const { data } = await createAdminClient().from("drivers").select("id").eq("profile_id", user.id).maybeSingle();
  return data?.id ?? null;
}

export async function POST(req: Request) {
  const driverId = await currentDriverId();
  if (!driverId) return NextResponse.json({ ok: false, error: "not_a_driver" }, { status: 403 });

  const sub = (await req.json().catch(() => null)) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  } | null;
  if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ ok: false, error: "bad_subscription" }, { status: 400 });
  }

  const { error } = await createAdminClient()
    .from("push_subscriptions")
    .upsert(
      {
        driver_id: driverId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      },
      { onConflict: "endpoint" }
    );
  if (error) return NextResponse.json({ ok: false, error: "save_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const driverId = await currentDriverId();
  if (!driverId) return NextResponse.json({ ok: false, error: "not_a_driver" }, { status: 403 });
  const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (endpoint) {
    await createAdminClient().from("push_subscriptions").delete().eq("driver_id", driverId).eq("endpoint", endpoint);
  }
  return NextResponse.json({ ok: true });
}
