import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The service-role client, locked to ONE company. Server-only.
 *
 * The service role bypasses row-level security, so code using it must scope
 * every query by hand — and a forgotten `.eq("company_id", …)` would quietly
 * reach every company's data. This wrapper makes that impossible for the
 * tables it touches: every select, update and delete is filtered to the
 * company, and every insert/upsert is stamped with it (the database then also
 * checks that the row only points at that company's rows).
 *
 * Use it wherever server code acts for a company. Only platform code (the
 * master dashboard, signup, cross-company cron sweeps) uses the bare client.
 */

// The query builders are returned untyped on purpose: the tables have no
// generated types (rows were already loose records with the bare client), and
// threading supabase-js's generics through a wrapper makes `tsc` run out of
// memory.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;
type Row = Record<string, unknown>;
type Count = { count?: "exact" | "planned" | "estimated" };

export interface TenantTable {
  select(columns?: string, options?: Count & { head?: boolean }): Query;
  update(values: Row, options?: Count): Query;
  delete(options?: Count): Query;
  insert(values: Row | Row[], options?: Count & { defaultToNull?: boolean }): Query;
  upsert(values: Row | Row[], options?: Count & { onConflict?: string; ignoreDuplicates?: boolean }): Query;
}

export interface TenantDb {
  companyId: string;
  from(table: string): TenantTable;
}

export function tenantDb(companyId: string): TenantDb {
  if (!companyId) throw new Error("tenantDb needs a company id");
  const admin = createAdminClient();
  const stamp = (v: Row | Row[]) =>
    Array.isArray(v) ? v.map((r) => ({ ...r, company_id: companyId })) : { ...v, company_id: companyId };

  return {
    companyId,
    from(table: string): TenantTable {
      const qb: Query = admin.from(table);
      return {
        select: (columns, options) => qb.select(columns, options).eq("company_id", companyId),
        update: (values, options) => qb.update(values, options).eq("company_id", companyId),
        delete: (options) => qb.delete(options).eq("company_id", companyId),
        insert: (values, options) => qb.insert(stamp(values), options),
        upsert: (values, options) => qb.upsert(stamp(values), options),
      };
    },
  };
}
