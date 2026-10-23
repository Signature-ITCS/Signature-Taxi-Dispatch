-- ─────────────────────────────────────────────────────────────────────────────
-- Clear demo / test data before handing the system over.
--
-- Run in Supabase → SQL Editor. TAKE A BACKUP FIRST (GitHub → Actions →
-- "Database backup" → Run workflow) — this cannot be undone otherwise.
--
-- KEPT: vehicle types, prices & distance bands, extra charges, settings,
--       website/widget keys, admin & dispatcher logins.
-- No emails, SMS or push messages are sent (TRUNCATE fires no row triggers).
-- ─────────────────────────────────────────────────────────────────────────────

-- PART 1 — bookings, customers and everything attached to them.
do $$
declare t text;
begin
  foreach t in array array[
    'payments', 'ratings', 'ride_events', 'checkout_drafts',
    'staff_notifications', 'cash_settlements', 'stripe_events',
    'bookings', 'customers', 'activity_logs'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('truncate table public.%I restart identity cascade', t);
    end if;
  end loop;
end $$;

-- Everyone's notification bell starts at zero.
update public.profiles set notifications_seen_at = now();


-- PART 2 (optional) — test DRIVERS, their cars, locations and app logins.
-- Only if the client will add their own drivers. Remove the /* and */ to run.
/*
delete from auth.users
where id in (select profile_id from public.drivers where profile_id is not null)
  and id in (select id from public.profiles where role = 'driver');

do $$
declare t text;
begin
  foreach t in array array['driver_locations', 'push_subscriptions', 'vehicles', 'drivers'] loop
    if to_regclass('public.' || t) is not null then
      execute format('truncate table public.%I restart identity cascade', t);
    end if;
  end loop;
end $$;
*/


-- Check: every count should be 0.
select 'bookings' as table_name, count(*) from public.bookings
union all select 'customers', count(*) from public.customers
union all select 'payments', count(*) from public.payments
union all select 'drivers (0 only if part 2 ran)', count(*) from public.drivers;
