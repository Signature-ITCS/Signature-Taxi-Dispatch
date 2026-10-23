import { NextResponse } from "next/server";
import { getPlatformAdmin, getCompany, audit } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { restoreFromBackup, saveBackup } from "@/lib/backups";

export const maxDuration = 60;

/** A company's backups (platform owner) — any plan, e.g. for a paid restore. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getPlatformAdmin())) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const { id } = await ctx.params;
  const { data } = await createAdminClient()
    .from("company_backups")
    .select("id, created_at, size_bytes, row_count")
    .eq("company_id", id)
    .order("created_at", { ascending: false })
    .limit(60);
  return NextResponse.json({ ok: true, backups: data ?? [] });
}

/** { action: "backup" } takes one now; { action: "restore", backup_id, confirm } restores. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await getPlatformAdmin();
  if (!owner) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const { id } = await ctx.params;
  const company = await getCompany(id);
  if (!company) return NextResponse.json({ ok: false, error: "not_found" });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (b.action === "backup") {
    try {
      await saveBackup(id);
      await audit("backup_taken", { actorId: owner.userId, actorEmail: owner.email, companyId: id });
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error("[master] backup failed", err);
      return NextResponse.json({ ok: false, error: "backup_failed" });
    }
  }
  if (b.action === "restore") {
    if (String(b.confirm ?? "").trim() !== company.name.trim()) return NextResponse.json({ ok: false, error: "confirm_mismatch" });
    const result = await restoreFromBackup(id, String(b.backup_id ?? ""));
    await audit(result.ok ? "company_restored" : "company_restore_failed", {
      actorId: owner.userId,
      actorEmail: owner.email,
      companyId: id,
      detail: { backup: b.backup_id, error: result.error ?? null, by: "platform" },
    });
    return NextResponse.json(result);
  }
  return NextResponse.json({ ok: false, error: "bad_request" });
}
