import { NextResponse } from "next/server";
import { getPlatformAdmin, audit } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { listPlans } from "@/lib/billing";
import { planFields } from "./fields";

/** All plans (platform owner). */
export async function GET() {
  if (!(await getPlatformAdmin())) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  return NextResponse.json({ ok: true, plans: await listPlans() });
}

/** Add a plan. It becomes sellable once synced to Stripe. */
export async function POST(req: Request) {
  const owner = await getPlatformAdmin();
  if (!owner) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const f = planFields((await req.json().catch(() => ({}))) as Record<string, unknown>, true);
  if ("error" in f) return NextResponse.json({ ok: false, error: f.error });
  const { data, error } = await createAdminClient().from("plans").insert(f.values).select("id").single();
  if (error) return NextResponse.json({ ok: false, error: error.code === "23505" ? "code_in_use" : "save_failed" });
  await audit("plan_created", { actorId: owner.userId, actorEmail: owner.email, detail: f.values });
  return NextResponse.json({ ok: true, id: data.id });
}
