/** Validate plan fields sent by the master dashboard. */
export function planFields(
  b: Record<string, unknown>,
  requireAll: boolean
): { values: Record<string, unknown> } | { error: string } {
  const v: Record<string, unknown> = {};
  const has = (k: string) => k in b;
  const limit = (x: unknown) => (x === null || x === "" ? null : Math.max(0, Math.floor(Number(x))));

  if (requireAll || has("code")) {
    const code = String(b.code ?? "").trim().toLowerCase();
    if (!/^[a-z0-9-]{2,30}$/.test(code)) return { error: "invalid_code" };
    v.code = code;
  }
  if (requireAll || has("name")) {
    const name = String(b.name ?? "").trim().slice(0, 60);
    if (!name) return { error: "invalid_name" };
    v.name = name;
  }
  if (has("description")) v.description = String(b.description ?? "").trim().slice(0, 200) || null;
  if (requireAll || has("price_monthly")) {
    const p = Number(b.price_monthly);
    if (!Number.isFinite(p) || p < 0 || p > 100000) return { error: "invalid_price" };
    v.price_monthly = Math.round(p * 100) / 100;
  }
  for (const k of ["max_drivers", "max_staff", "max_bookings_month"]) {
    if (has(k)) {
      const n = limit(b[k]);
      if (n !== null && !Number.isFinite(n)) return { error: `invalid_${k}` };
      v[k] = n;
    }
  }
  if (has("backups_included")) v.backups_included = !!b.backups_included;
  if (has("is_public")) v.is_public = !!b.is_public;
  if (has("is_active")) v.is_active = !!b.is_active;
  if (has("trial_days")) v.trial_days = Math.min(Math.max(Math.floor(Number(b.trial_days) || 0), 0), 90);
  if (has("sort_order")) v.sort_order = Math.floor(Number(b.sort_order) || 0);
  if (has("features")) {
    const list = Array.isArray(b.features) ? b.features : String(b.features ?? "").split("\n");
    v.features = list.map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
  }
  return { values: v };
}
