import { NextResponse } from "next/server";
import { getOfficeContext } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveBackup, pruneBackups } from "@/lib/backups";
import { tenantDb } from "@/lib/tenantDb";
import { rateLimit } from "@/lib/rateLimit";

/** Is self-service backup part of this company's plan? */
async function included(companyId: string): Promise<boolean> {
  const { data } = await createAdminClient().rpc("company_usage", { p_company: companyId });
  return !!(data as { backups_included?: boolean } | null)?.backups_included;
}

/** The company's backups (admins). Every plan is backed up; downloads/restores need the plan feature. */
export async function GET() {
  const office = await getOfficeContext({ adminOnly: true });
  if (!office) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const { data } = await tenantDb(office.company.id)
    .from("company_backups")
    .select("id, created_at, size_bytes, row_count")
    .order("created_at", { ascending: false })
    .limit(60);
  return NextResponse.json({ ok: true, included: await included(office.company.id), backups: data ?? [] });
}

/** Take a backup now (e.g. before a big change to prices). */
export async function POST() {
  const office = await getOfficeContext({ adminOnly: true });
  if (!office) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  if (!(await included(office.company.id))) return NextResponse.json({ ok: false, error: "not_in_plan" });
  if (!rateLimit(`backup-now:${office.company.id}`, 3, 60 * 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" });
  }
  try {
    const r = await saveBackup(office.company.id);
    await pruneBackups(office.company.id);
    await tenantDb(office.company.id).from("activity_logs").insert({
      actor_id: office.profile.id,
      actor_name: office.profile.full_name,
      actor_role: office.profile.role,
      action: "backup_created",
      description: `Backup taken (${r.rows} rows)`,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[backups] manual backup failed", err);
    return NextResponse.json({ ok: false, error: "backup_failed" });
  }
}
