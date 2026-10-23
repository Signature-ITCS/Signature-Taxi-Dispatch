import { createAdminClient } from "@/lib/supabase/admin";
import { tenantDb } from "@/lib/tenantDb";

/**
 * Per-company backups. Server-only.
 *
 * Every night each company's own rows are exported to one JSON file in the
 * private "company-backups" storage bucket (kept KEEP_DAYS days). A restore
 * puts back exactly one company, in one database transaction
 * (restore_company in db/2026-10-24_platform.sql) — other companies are
 * never touched. This is separate from, and as well as, the whole-database
 * backups (Supabase's own, and the GitHub Actions one in db/BACKUPS.md).
 *
 * All plans are backed up. Whether a company may download and restore its own
 * backups is a plan feature (`backups_included`); otherwise the platform owner
 * restores on request.
 */
export const BUCKET = "company-backups";
export const KEEP_DAYS = 30;

/** Tables in a company backup, in the order they are restored. */
export const BACKUP_TABLES = [
  "app_settings", "websites", "vehicle_categories", "pricing_rules", "pricing_bands", "pricing_zones",
  "fixed_routes", "drivers", "vehicles", "customers", "bookings", "payments", "ride_events", "ratings",
  "cash_settlements", "staff_notifications", "activity_logs",
] as const;

export interface CompanyBackup {
  version: 1;
  company_id: string;
  exported_at: string;
  tables: Record<string, Record<string, unknown>[]>;
}

/** Every row of every table that belongs to the company. */
export async function exportCompany(companyId: string): Promise<CompanyBackup> {
  const db = tenantDb(companyId);
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of BACKUP_TABLES) {
    const rows: Record<string, unknown>[] = [];
    // Pages of 1000 (PostgREST's default cap).
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(t).select("*").range(from, from + 999);
      if (error) throw new Error(`export ${t}: ${error.message}`);
      rows.push(...((data ?? []) as Record<string, unknown>[]));
      if (!data || data.length < 1000) break;
    }
    tables[t] = rows;
  }
  return { version: 1, company_id: companyId, exported_at: new Date().toISOString(), tables };
}

/** Export and store a backup now. */
export async function saveBackup(companyId: string): Promise<{ path: string; rows: number; bytes: number }> {
  const backup = await exportCompany(companyId);
  const body = JSON.stringify(backup);
  const rows = Object.values(backup.tables).reduce((n, r) => n + r.length, 0);
  const path = `${companyId}/${backup.exported_at.replace(/[:.]/g, "-")}.json`;
  const admin = createAdminClient();
  const { error } = await admin.storage.from(BUCKET).upload(path, body, { contentType: "application/json", upsert: false });
  if (error) throw new Error(`upload: ${error.message}`);
  await admin.from("company_backups").insert({ company_id: companyId, path, size_bytes: body.length, row_count: rows });
  return { path, rows, bytes: body.length };
}

/** Remove a company's backups older than KEEP_DAYS. */
export async function pruneBackups(companyId: string): Promise<number> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60_000).toISOString();
  const { data: old } = await admin
    .from("company_backups")
    .select("id, path")
    .eq("company_id", companyId)
    .lt("created_at", cutoff);
  if (!old?.length) return 0;
  await admin.storage.from(BUCKET).remove(old.map((o) => o.path as string));
  await admin.from("company_backups").delete().in("id", old.map((o) => o.id as string));
  return old.length;
}

/** A stored backup of this company (the path is checked to belong to it). */
export async function loadBackup(companyId: string, backupId: string): Promise<{ backup: CompanyBackup; raw: string } | null> {
  const admin = createAdminClient();
  const { data: meta } = await admin
    .from("company_backups")
    .select("path")
    .eq("id", backupId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!meta?.path || !(meta.path as string).startsWith(`${companyId}/`)) return null;
  const { data, error } = await admin.storage.from(BUCKET).download(meta.path as string);
  if (error || !data) return null;
  const raw = await data.text();
  const backup = JSON.parse(raw) as CompanyBackup;
  if (backup.company_id !== companyId) return null;
  return { backup, raw };
}

/** Put a company back to a stored backup. Callers check who may do this. */
export async function restoreFromBackup(companyId: string, backupId: string): Promise<{ ok: boolean; error?: string; rows?: unknown }> {
  const loaded = await loadBackup(companyId, backupId);
  if (!loaded) return { ok: false, error: "backup_not_found" };
  // A fresh backup first, so a restore can itself be undone.
  try {
    await saveBackup(companyId);
  } catch (err) {
    console.error("[backups] pre-restore backup failed", err);
    return { ok: false, error: "safety_backup_failed" };
  }
  const { data, error } = await createAdminClient().rpc("restore_company", { p_company: companyId, p_data: loaded.backup });
  if (error) {
    console.error("[backups] restore failed", error);
    return { ok: false, error: "restore_failed" };
  }
  return { ok: true, rows: (data as { rows?: unknown } | null)?.rows };
}

/** Nightly: back up every company that is not cancelled, then prune. */
export async function runNightlyBackups(): Promise<{ done: number; failed: number }> {
  const admin = createAdminClient();
  const { data: companies } = await admin.from("companies").select("id").neq("status", "cancelled");
  let done = 0;
  let failed = 0;
  for (const c of companies ?? []) {
    try {
      await saveBackup(c.id as string);
      await pruneBackups(c.id as string);
      done++;
    } catch (err) {
      failed++;
      console.error("[backups] nightly backup failed", c.id, err);
    }
  }
  return { done, failed };
}
