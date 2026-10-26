-- One company's data as a single JSON document — the same format as the app's
-- nightly company backups (src/lib/backups.ts), plus the company row itself so
-- a deleted company can be put back. Used by db-backup.yml:
--   psql "$SUPABASE_DB_URL" -At -v cid=<company id> -f export-company.sql
select jsonb_build_object(
  'version', 1,
  'company_id', c.id,
  'exported_at', now(),
  'source', 'github-nightly',
  'company', to_jsonb(c),
  'tables', jsonb_build_object(
    'app_settings',        (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.app_settings x        where x.company_id = c.id),
    'websites',            (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.websites x            where x.company_id = c.id),
    'vehicle_categories',  (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.vehicle_categories x  where x.company_id = c.id),
    'pricing_rules',       (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.pricing_rules x       where x.company_id = c.id),
    'pricing_bands',       (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.pricing_bands x       where x.company_id = c.id),
    'pricing_zones',       (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.pricing_zones x       where x.company_id = c.id),
    'fixed_routes',        (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.fixed_routes x        where x.company_id = c.id),
    'drivers',             (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.drivers x             where x.company_id = c.id),
    'vehicles',            (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.vehicles x            where x.company_id = c.id),
    'customers',           (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.customers x           where x.company_id = c.id),
    'bookings',            (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.bookings x            where x.company_id = c.id),
    'payments',            (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.payments x            where x.company_id = c.id),
    'ride_events',         (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.ride_events x         where x.company_id = c.id),
    'ratings',             (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.ratings x             where x.company_id = c.id),
    'cash_settlements',    (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.cash_settlements x    where x.company_id = c.id),
    'staff_notifications', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.staff_notifications x where x.company_id = c.id),
    'activity_logs',       (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.activity_logs x       where x.company_id = c.id)
  )
)
from public.companies c
where c.id = :'cid'::uuid;
