import { NextResponse } from "next/server";
import { getOfficeContext, audit } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { restoreFromBackup } from "@/lib/backups";
import { tenantDb } from "@/lib/tenantDb";
import { rateLimit } from "@/lib/rateLimit";

export const maxDuration = 60;

/**
 * Put the company back to one of its own backups. Admins of plans with
 * self-service restore only, and only after typing the company name. A fresh
 * backup is taken first, so the restore itself can be undone.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const office = await getOfficeContext({ adminOnly: true });
  if (!office) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const companyId = office.company.id;
  const { data } = await createAdminClient().rpc("company_usage", { p_company: companyId });
  if (!(data as { backups_included?: boolean } | null)?.backups_included) {
    return NextResponse.json({ ok: false, error: "not_in_plan" });
  }
  const { confirm } = (await req.json().catch(() => ({}))) as { confirm?: string };
  if (String(confirm ?? "").trim().toLowerCase() !== office.company.name.trim().toLowerCase()) {
    return NextResponse.json({ ok: false, error: "confirm_mismatch" });
  }
  if (!rateLimit(`restore:${companyId}`, 3, 60 * 60_000)) return NextResponse.json({ ok: false, error: "rate_limited" });

  const { id } = await ctx.params;
  const result = await restoreFromBackup(companyId, id);
  await audit(result.ok ? "company_restored" : "company_restore_failed", {
    actorId: office.userId,
    actorEmail: office.email,
    companyId,
    detail: { backup: id, error: result.error ?? null },
  });
  if (result.ok) {
    await tenantDb(companyId).from("activity_logs").insert({
      actor_id: office.profile.id,
      actor_name: office.profile.full_name,
      actor_role: office.profile.role,
      action: "backup_restored",
      description: "Restored the company's data from a backup",
    });
  }
  return NextResponse.json(result);
}
