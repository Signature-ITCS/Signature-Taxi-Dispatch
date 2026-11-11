-- ─────────────────────────────────────────────────────────────────────────────
-- Clear ONE company's demo / test data before handing it over.
-- (Black Falcon's reset_demo_data.sql, made safe for the shared database:
--  BF used TRUNCATE, which here would wipe EVERY company.)
--
-- 1. TAKE A BACKUP FIRST (backups repo → Actions → "Database backup").
-- 2. Put the company's slug on the line marked  ◀◀  below.
-- 3. Run in Supabase → SQL Editor.
--
-- KEPT: the company itself, its vehicle types, prices, bands, areas, extra
--       charges, settings, website/widget keys, admin & dispatcher logins,
--       corporate accounts (their invoices are cleared).
-- Only rows of that one company are touched. Nothing is emailed or texted.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_slug     text := 'put-the-company-slug-here';   -- ◀◀ the company to clear
  v_drivers  boolean := false;                       -- true = also remove its test drivers, cars and driver logins
  v_company  uuid;
  t          text;
  n          int;
begin
  select id into v_company from public.companies where slug = v_slug;
  if v_company is null then
    raise exception 'No company with slug "%" — check the slug (Master → Companies).', v_slug;
  end if;

  -- Children first.
  foreach t in array array[
    'invoices', 'payments', 'ratings', 'ride_events', 'checkout_drafts',
    'staff_notifications', 'cash_settlements', 'stripe_events',
    'bookings', 'customers', 'activity_logs'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I where company_id = $1', t) using v_company;
      get diagnostics n = row_count;
      raise notice '% : % rows removed', t, n;
    end if;
  end loop;

  if to_regclass('public.account_invoice_counters') is not null then
    delete from public.account_invoice_counters where company_id = v_company;   -- invoices start again at INV-1001
  end if;

  -- Everyone in this company starts with an empty notification bell.
  update public.profiles set notifications_seen_at = now() where company_id = v_company;

  if v_drivers then
    delete from auth.users u
     using public.profiles p
     where p.id = u.id and p.company_id = v_company and p.role = 'driver';
    foreach t in array array['driver_locations', 'push_subscriptions', 'vehicles', 'drivers'] loop
      if to_regclass('public.' || t) is not null then
        execute format('delete from public.%I where company_id = $1', t) using v_company;
        get diagnostics n = row_count;
        raise notice '% : % rows removed', t, n;
      end if;
    end loop;
  end if;
end $$;

-- Check: what this company has left (bookings / customers should be 0).
select c.slug,
       (select count(*) from public.bookings  b where b.company_id = c.id) as bookings,
       (select count(*) from public.customers x where x.company_id = c.id) as customers,
       (select count(*) from public.drivers   d where d.company_id = c.id) as drivers
  from public.companies c
 order by c.slug;
