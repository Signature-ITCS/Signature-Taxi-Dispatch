import { NextResponse } from "next/server";
import { getPlatformAdmin } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";

/** Master dashboard home: companies by status, monthly income, open requests. */
export async function GET() {
  if (!(await getPlatformAdmin())) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const admin = createAdminClient();
  const [{ data: companies }, { data: plans }, { count: setupOpen }, { count: restoreOpen }, { data: recent }] = await Promise.all([
    admin.from("companies").select("id, status, plan_id"),
    admin.from("plans").select("id, price_monthly"),
    admin.from("setup_requests").select("id", { count: "exact", head: true }).in("status", ["new", "in_progress"]),
    admin.from("restore_requests").select("id", { count: "exact", head: true }).in("status", ["new", "in_progress"]),
    admin.from("companies").select("id, name, status, created_at, plans(name)").order("created_at", { ascending: false }).limit(8),
  ]);
  const price = new Map((plans ?? []).map((p) => [p.id as string, Number(p.price_monthly) || 0]));
  const by = (s: string) => (companies ?? []).filter((c) => c.status === s).length;
  const mrr = (companies ?? []).filter((c) => c.status === "active" || c.status === "past_due").reduce((n, c) => n + (price.get(c.plan_id as string) ?? 0), 0);
  return NextResponse.json({
    ok: true,
    stats: {
      companies: (companies ?? []).length,
      active: by("active"),
      trialing: by("trialing"),
      past_due: by("past_due"),
      suspended: by("suspended") + by("cancelled"),
      mrr,
      open_requests: (setupOpen ?? 0) + (restoreOpen ?? 0),
    },
    recent: recent ?? [],
  });
}
