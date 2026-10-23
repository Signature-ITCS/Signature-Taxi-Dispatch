import { getOfficeContext } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadBackup } from "@/lib/backups";

/** Download one of the company's own backups (admins, plans with backups). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const office = await getOfficeContext({ adminOnly: true });
  if (!office) return new Response("Not allowed", { status: 403 });
  const { data } = await createAdminClient().rpc("company_usage", { p_company: office.company.id });
  if (!(data as { backups_included?: boolean } | null)?.backups_included) {
    return new Response("Backup downloads are not part of your plan", { status: 403 });
  }
  const { id } = await ctx.params;
  const loaded = await loadBackup(office.company.id, id);
  if (!loaded) return new Response("Not found", { status: 404 });
  const stamp = loaded.backup.exported_at.slice(0, 10);
  return new Response(loaded.raw, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${office.company.slug}-backup-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
