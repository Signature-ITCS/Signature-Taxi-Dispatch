import { NextResponse } from "next/server";
import { getPlatformAdmin, audit } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { planFields } from "../fields";

/**
 * Change a plan. A new price applies to invoices made from now on (Master →
 * Billing); invoices already made keep their amount (edit them there).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await getPlatformAdmin();
  if (!owner) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const { id } = await ctx.params;
  const admin = createAdminClient();
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const f = planFields(b, false);
  if ("error" in f) return NextResponse.json({ ok: false, error: f.error });
  if (!Object.keys(f.values).length) return NextResponse.json({ ok: true });
  const { error } = await admin.from("plans").update({ ...f.values, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.code === "23505" ? "code_in_use" : "save_failed" });
  await audit("plan_updated", { actorId: owner.userId, actorEmail: owner.email, detail: { plan: id, ...f.values } });
  return NextResponse.json({ ok: true });
}
