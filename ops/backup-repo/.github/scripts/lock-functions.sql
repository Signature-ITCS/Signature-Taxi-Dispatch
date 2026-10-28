-- ─────────────────────────────────────────────────────────────────────────────
-- Lock the platform's internal database functions                 (2026-10-27)
--
-- These run with full rights and must only ever be called by the app's server
-- (service role) or by the database itself — never by a visitor or a company
-- login through the public API.
--
-- Why a separate file: Supabase gives every new function in the public schema
-- EXECUTE for anon and authenticated by default. A whole-database restore
-- (pg_dump) re-creates the functions and only replays "revoke from public", so
-- those default grants come back. Run this after ANY whole-database restore;
-- the GitHub "Restore database" workflow and the backup file now do it
-- automatically.
--
-- Safe to run any number of times.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.platform_add_owner(text)',
    'public.seed_company(uuid)',
    'public.restore_company(uuid, jsonb)',
    'public.company_usage(uuid)',
    'public.company_plan(uuid)',
    'public.company_bookings_this_month(uuid)',
    'public.company_is_open(uuid)',
    'public.sync_driver_availability(uuid)',
    'public.run_booking_reminders()',
    'public.platform_generate_invoices(integer)',
    'public.platform_mark_invoice_paid(uuid, timestamp with time zone, text)',
    'public.platform_unmark_invoice_paid(uuid)',
    'public.hit_rate_limit(text, integer, integer)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
