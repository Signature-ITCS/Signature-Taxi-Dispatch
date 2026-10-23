-- ─────────────────────────────────────────────────────────────────────────────
-- Multi-company platform                                         (2026-10-24)
--
-- Turns the single-company dispatch into a platform that hosts many companies
-- in ONE database:
--
--   • plans, companies, platform admins, platform settings, encrypted secrets,
--     setup/restore requests and an audit log;
--   • company_id on every company-owned table, filled in automatically and
--     checked so a row can never point at another company's row;
--   • row-level security rewritten: staff and drivers only ever see rows of
--     their own company, and nothing at all while the company is suspended;
--   • the public pricing / booking functions work out the company from the
--     website key and only ever touch that company's data;
--   • plan limits (drivers, office staff, bookings a month) enforced here, so
--     no code path can get round them.
--
-- For a NEW, EMPTY database only (it refuses to convert one that already has
-- bookings or staff). Runs after every earlier file — db/platform_setup.sql
-- is all of them joined in order. Safe to run twice.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 0. Fresh databases only ──────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.companies') is null
     and (exists (select 1 from public.bookings) or exists (select 1 from public.profiles)) then
    raise exception 'This database already has bookings or staff. The platform setup is for a new, empty database — nothing was changed.';
  end if;
end $$;

-- ── 1. Platform tables ───────────────────────────────────────────────────────
create table if not exists public.plans (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  name                text not null,
  description         text,
  price_monthly       numeric(10,2) not null default 0,
  currency            text not null default 'gbp',
  -- null = unlimited
  max_drivers         int,
  max_staff           int,
  max_bookings_month  int,
  -- Backup downloads and self-service restore. Without it a restore is a paid
  -- job done by the platform owner.
  backups_included    boolean not null default false,
  features            jsonb not null default '[]'::jsonb,
  trial_days          int not null default 14,
  is_public           boolean not null default true,
  is_active           boolean not null default true,
  sort_order          int not null default 0,
  stripe_product_id   text,
  stripe_price_id     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.companies (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  -- Used in addresses: /book/<slug>, /embed/<slug>
  slug                    text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  status                  text not null default 'trialing'
                          check (status in ('trialing', 'active', 'past_due', 'suspended', 'cancelled')),
  plan_id                 uuid references public.plans(id),
  owner_email             text,
  trial_ends_at           timestamptz,
  current_period_end      timestamptz,
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  custom_domain           text unique,
  -- The company lets the platform owner into its account until this time.
  support_access_until    timestamptz,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists companies_plan_idx on public.companies (plan_id);

create table if not exists public.platform_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- Non-secret platform configuration (name, support address, webhook URLs).
create table if not exists public.platform_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- API keys and passwords, encrypted by the app before they arrive here
-- (AES-256-GCM, key in the SECRETS_ENCRYPTION_KEY environment variable).
-- company_id null = a platform secret. Never readable by any logged-in user.
create table if not exists public.secrets (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade,
  name        text not null,
  ciphertext  text not null,
  last4       text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create unique index if not exists secrets_company_name_key
  on public.secrets (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

create table if not exists public.setup_requests (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  package        text not null,
  details        text,
  contact_name   text,
  contact_email  text,
  status         text not null default 'new' check (status in ('new', 'in_progress', 'done', 'cancelled')),
  paid           boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.restore_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  backup_date   date,
  note          text,
  requested_by  uuid,
  status        text not null default 'new' check (status in ('new', 'in_progress', 'done', 'cancelled')),
  paid          boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Nightly per-company exports (files in the private "company-backups" bucket).
create table if not exists public.company_backups (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  path        text not null,
  size_bytes  bigint,
  row_count   int,
  created_at  timestamptz not null default now()
);
create index if not exists company_backups_company_idx on public.company_backups (company_id, created_at desc);

create table if not exists public.platform_audit (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid,
  actor_email  text,
  company_id   uuid references public.companies(id) on delete set null,
  action       text not null,
  detail       jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists platform_audit_created_idx on public.platform_audit (created_at desc);

-- ── 2. Starting plans and settings ───────────────────────────────────────────
insert into public.plans (code, name, description, price_monthly, max_drivers, max_staff, max_bookings_month, backups_included, features, sort_order)
values
  ('starter', 'Starter', 'For small firms getting started', 49, 3, 2, 300, false,
   '["Booking site and widget", "Dispatch board and driver app", "Cash and card payments", "SMS and email notifications"]', 0),
  ('pro', 'Pro', 'For growing firms', 99, 7, 5, 600, true,
   '["Everything in Starter", "Fixed prices and night rate", "Live driver map and reminders", "Backup downloads and restore"]', 1),
  ('business', 'Business', 'For larger fleets', 199, 15, 10, 1500, true,
   '["Everything in Pro", "Priority support", "Backup downloads and restore"]', 2)
on conflict (code) do nothing;

insert into public.platform_settings (key, value) values
  ('platform', jsonb_build_object('name', 'Dispatch Platform', 'support_email', '', 'from_email', '')),
  ('webhooks', jsonb_build_object(
      'booking_status_url', 'https://booking.airport-transfer.uk/api/webhooks/booking-status',
      'reminders_url',      'https://booking.airport-transfer.uk/api/cron/reminders'))
on conflict (key) do nothing;

-- ── 3. company_id on every company-owned table ───────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'websites', 'vehicle_categories', 'pricing_bands', 'pricing_rules', 'drivers',
    'vehicles', 'customers', 'bookings', 'payments', 'checkout_drafts', 'stripe_events',
    'ride_events', 'ratings', 'cash_settlements', 'activity_logs', 'app_settings',
    'push_subscriptions', 'driver_locations', 'staff_notifications', 'pricing_zones', 'fixed_routes'
  ] loop
    execute format('alter table public.%I add column if not exists company_id uuid references public.companies(id) on delete cascade', t);
    execute format('create index if not exists %I on public.%I (company_id)', t || '_company_idx', t);
  end loop;
end $$;

-- The single-company starting data (car classes, prices, settings) belonged to
-- nobody; every company now gets its own copy from seed_company().
delete from public.app_settings where company_id is null;
delete from public.pricing_bands where company_id is null;
delete from public.pricing_rules where company_id is null;
delete from public.fixed_routes where company_id is null;
delete from public.pricing_zones where company_id is null;
delete from public.vehicle_categories where company_id is null;
delete from public.websites where company_id is null;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'websites', 'vehicle_categories', 'pricing_bands', 'pricing_rules', 'drivers',
    'vehicles', 'customers', 'bookings', 'payments', 'checkout_drafts', 'stripe_events',
    'ride_events', 'ratings', 'cash_settlements', 'activity_logs', 'app_settings',
    'push_subscriptions', 'driver_locations', 'staff_notifications', 'pricing_zones', 'fixed_routes'
  ] loop
    execute format('alter table public.%I alter column company_id set not null', t);
  end loop;
end $$;

-- Per-company uniqueness.
alter table public.customers drop constraint if exists customers_whatsapp_key;
create unique index if not exists customers_company_whatsapp_key on public.customers (company_id, whatsapp);
alter table public.app_settings drop constraint if exists app_settings_pkey;
create unique index if not exists app_settings_company_key on public.app_settings (company_id, key);

-- Hot paths filter by company first.
create index if not exists bookings_company_created_idx on public.bookings (company_id, created_at desc);
create index if not exists bookings_company_status_idx on public.bookings (company_id, status);

-- ── 4. Who is asking ─────────────────────────────────────────────────────────
-- The signed-in user's company — only while that company may use the system.
create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select p.company_id
    from profiles p
    join companies c on c.id = p.company_id
   where p.id = auth.uid() and p.is_active
     and c.status in ('trialing', 'active', 'past_due');
$$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

-- Drivers of a suspended company are locked out too.
create or replace function public.current_driver_id()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select d.id
    from drivers d
    join companies c on c.id = d.company_id
   where d.profile_id = auth.uid() and c.status in ('trialing', 'active', 'past_due');
$$;

create or replace function public.company_is_open(p_company uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from companies where id = p_company and status in ('trialing', 'active', 'past_due'));
$$;

-- ── 5. company_id filled in and checked on every write ───────────────────────
-- Filled from the row it belongs to (a booking, driver, car class…) or, for a
-- signed-in user, from their own company. Then every reference on the row is
-- checked to be in the same company — a booking can never be given another
-- company's driver, customer or car class, even by a hand-crafted request.
create or replace function public.tenant_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  j jsonb := to_jsonb(new);
  v uuid;
  ref record;
begin
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    raise exception 'A row cannot move to another company (%)', tg_table_name;
  end if;

  if new.company_id is null then
    if j->>'booking_id' is not null then
      select company_id into v from bookings where id = (j->>'booking_id')::uuid;
    elsif j->>'driver_id' is not null then
      select company_id into v from drivers where id = (j->>'driver_id')::uuid;
    elsif j->>'category_id' is not null then
      select company_id into v from vehicle_categories where id = (j->>'category_id')::uuid;
    elsif j->>'from_zone_id' is not null then
      select company_id into v from pricing_zones where id = (j->>'from_zone_id')::uuid;
    elsif j->>'website_id' is not null then
      select company_id into v from websites where id = (j->>'website_id')::uuid;
    end if;
    new.company_id := coalesce(v, current_company_id());
    if new.company_id is null then
      raise exception 'No company for new % row', tg_table_name;
    end if;
  end if;

  for ref in
    select * from (values
      ('booking_id', 'bookings'), ('driver_id', 'drivers'), ('notified_driver_id', 'drivers'),
      ('customer_id', 'customers'), ('category_id', 'vehicle_categories'),
      ('vehicle_category_id', 'vehicle_categories'), ('external_vehicle_category_id', 'vehicle_categories'),
      ('website_id', 'websites'), ('profile_id', 'profiles'), ('dispatcher_id', 'profiles'),
      ('from_zone_id', 'pricing_zones'), ('to_zone_id', 'pricing_zones')
    ) as r(col, tbl)
  loop
    if j->>ref.col is not null then
      execute format('select company_id from public.%I where id = $1', ref.tbl) into v using (j->>ref.col)::uuid;
      if v is not null and v <> new.company_id then
        raise exception 'Cross-company reference blocked: %.%', tg_table_name, ref.col;
      end if;
    end if;
  end loop;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'websites', 'vehicle_categories', 'pricing_bands', 'pricing_rules', 'drivers',
    'vehicles', 'customers', 'bookings', 'payments', 'checkout_drafts', 'stripe_events',
    'ride_events', 'ratings', 'cash_settlements', 'activity_logs', 'app_settings',
    'push_subscriptions', 'driver_locations', 'staff_notifications', 'pricing_zones', 'fixed_routes'
  ] loop
    -- "a_" so it runs before every other BEFORE trigger on the table.
    execute format('drop trigger if exists a_tenant_guard on public.%I', t);
    execute format('create trigger a_tenant_guard before insert or update on public.%I for each row execute function public.tenant_guard()', t);
  end loop;
end $$;

-- Staff cannot hand themselves another company either.
create or replace function public.guard_profile_privileged_columns()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if (new.role is distinct from old.role) or (new.is_active is distinct from old.is_active) then
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'Not authorized to change role or active status';
    end if;
  end if;
  return new;
end $$;

-- ── 6. Plan limits ───────────────────────────────────────────────────────────
create or replace function public.company_plan(p_company uuid)
returns plans language sql stable security definer set search_path to 'public' as $$
  select p.* from companies c join plans p on p.id = c.plan_id where c.id = p_company;
$$;

-- Bookings this calendar month (UK time). A return trip counts once.
create or replace function public.company_bookings_this_month(p_company uuid)
returns int language sql stable security definer set search_path to 'public' as $$
  select count(*)::int from bookings
   where company_id = p_company and not is_return
     and created_at >= (date_trunc('month', now() at time zone 'Europe/London') at time zone 'Europe/London');
$$;

-- Usage against the plan, for the dashboards.
create or replace function public.company_usage(p_company uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'drivers',  (select count(*) from drivers where company_id = p_company),
    'staff',    (select count(*) from profiles where company_id = p_company and is_active and role in ('admin', 'dispatcher')),
    'bookings_this_month', company_bookings_this_month(p_company),
    'max_drivers', p.max_drivers, 'max_staff', p.max_staff, 'max_bookings_month', p.max_bookings_month,
    'backups_included', coalesce(p.backups_included, false),
    'plan', p.name, 'plan_code', p.code)
  from (select 1) x left join lateral (select * from company_plan(p_company)) p on true;
$$;

create or replace function public.enforce_plan_limits()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  p plans%rowtype;
  n int;
begin
  select * into p from company_plan(new.company_id);
  if not found then return new; end if;

  -- One branch per table: a condition may only name columns its table has.
  if tg_table_name = 'drivers' then
    if tg_op = 'INSERT' and p.max_drivers is not null then
      select count(*) into n from drivers where company_id = new.company_id;
      if n >= p.max_drivers then
        raise exception 'plan_limit_drivers: your plan allows % drivers', p.max_drivers using errcode = 'P0001';
      end if;
    end if;
  elsif tg_table_name = 'profiles' then
    if p.max_staff is not null and new.is_active and new.role in ('admin', 'dispatcher') then
      -- Only a login that newly becomes an office user counts.
      if tg_op = 'INSERT' then
        n := 1;
      elsif old.is_active and old.role in ('admin', 'dispatcher') then
        n := 0;
      else
        n := 1;
      end if;
      if n = 1 then
        select count(*) into n from profiles
         where company_id = new.company_id and is_active and role in ('admin', 'dispatcher') and id <> new.id;
        if n >= p.max_staff then
          raise exception 'plan_limit_staff: your plan allows % office users', p.max_staff using errcode = 'P0001';
        end if;
      end if;
    end if;
  elsif tg_table_name = 'bookings' then
    if tg_op = 'INSERT' and p.max_bookings_month is not null and not new.is_return then
      if company_bookings_this_month(new.company_id) >= p.max_bookings_month then
        raise exception 'plan_limit_bookings: your plan allows % bookings a month', p.max_bookings_month using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists b_plan_limits on public.drivers;
create trigger b_plan_limits before insert on public.drivers for each row execute function public.enforce_plan_limits();
drop trigger if exists b_plan_limits on public.profiles;
create trigger b_plan_limits before insert or update of role, is_active on public.profiles for each row execute function public.enforce_plan_limits();
drop trigger if exists b_plan_limits on public.bookings;
create trigger b_plan_limits before insert on public.bookings for each row execute function public.enforce_plan_limits();

-- ── 7. A new company's starting data ─────────────────────────────────────────
-- Car classes, distance bands, extra charges, settings and its booking website.
-- Called when a company is created (signup or by the platform owner).
create or replace function public.seed_company(p_company uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  c companies%rowtype;
  v_cat uuid;
  r record;
begin
  select * into c from companies where id = p_company;
  if not found then raise exception 'No such company'; end if;
  if exists (select 1 from vehicle_categories where company_id = p_company) then return; end if;

  for r in
    select * from (values
      ('Saloon',    'Comfortable everyday ride, up to 4 passengers'::text, 'car',       4, 2, 2, 2.50, 0, array[10,10,8,6,5,4.5,3.5,3.2,3]::numeric[]),
      ('Estate',    null,                                            'car',       5, 4, 3, 3.50, 1, array[15,14,11,7,7,6,5,3.5,3.2]::numeric[]),
      ('Executive', 'Premium car with professional driver',          'car-front', 4, 3, 3, 5.00, 2, array[15,14,11,7,7,6,5,3.5,3.2]::numeric[]),
      ('MPV',       null,                                            'car-front', 6, 4, 4, 4.00, 3, array[15,14,11,7,7,6,5,3.5,3.2]::numeric[]),
      ('8 Seater',  'Spacious van for groups and luggage, up to 8',  'bus',       8, 6, 6, 4.00, 4, array[18,16,14,12,10,8,7,5,4]::numeric[])
    ) as v(name, description, icon, capacity, suitcases, hand_bags, base_fare, sort_order, rates)
  loop
    insert into vehicle_categories (company_id, name, description, icon, capacity, suitcases, hand_bags, base_fare, sort_order, is_active)
    values (p_company, r.name, r.description, r.icon, r.capacity, r.suitcases, r.hand_bags, r.base_fare, r.sort_order, true)
    returning id into v_cat;

    insert into pricing_bands (company_id, category_id, from_km, to_km, price_per_km, sort_order)
    select p_company, v_cat, b.from_km, b.to_km, r.rates[b.i], b.i - 1
      from (values (1, 0, 2), (2, 2, 3), (3, 3, 4), (4, 4, 5), (5, 5, 10), (6, 10, 25), (7, 25, 40), (8, 40, 50), (9, 50, 1000))
           as b(i, from_km, to_km);
  end loop;

  insert into pricing_rules (company_id, name, charge_type, amount, keyword, start_time, end_time, sort_order, exclude_keywords)
  values
    (p_company, 'Airport surcharge', 'fixed'::charge_type, 10, 'airport', null::time, null::time, 1, null::text),
    (p_company, 'Night rate', 'percentage'::charge_type, 20, null, '23:00'::time, '06:00'::time, 2, 'airport, heathrow, gatwick, stansted');

  insert into app_settings (company_id, key, value) values
    (p_company, 'company', jsonb_build_object('name', c.name, 'currency', 'GBP', 'currency_symbol', '£',
       'timezone', 'Europe/London', 'distance_unit', 'miles', 'support_whatsapp', '')),
    (p_company, 'booking', jsonb_build_object('allow_scheduled', true, 'min_advance_minutes', 30)),
    (p_company, 'child_seat_price', jsonb_build_object('amount', 5)),
    (p_company, 'distance_bands', jsonb_build_object('add_up', true)),
    (p_company, 'fixed_prices', jsonb_build_object('add_extras', false)),
    (p_company, 'notifications', jsonb_build_object('email_from', '', 'sms_sender', '')),
    (p_company, 'dispatch', jsonb_build_object('auto_assign', false, 'sound_alerts', true, 'driver_accept_timeout_seconds', 15)),
    (p_company, 'branding', jsonb_build_object('primary_color', '#1d4ed8', 'dark_color', '#0f172a', 'logo_url', '')),
    (p_company, 'map', jsonb_build_object('default_center_lat', 51.5074, 'default_center_lng', -0.1278, 'default_zoom', 12))
  on conflict do nothing;

  -- Its booking address is /book/<company slug>; another website may already
  -- use that slug, so fall back to a suffixed one.
  insert into websites (company_id, name, slug)
  values (p_company, 'Main website',
          case when exists (select 1 from websites where slug = c.slug)
               then c.slug || '-' || substr(md5(random()::text), 1, 4) else c.slug end);
end $$;

-- ── 8. Company-aware pricing and booking ─────────────────────────────────────
-- estimate_fare: the car class says which company's settings to use. Its body
-- is otherwise exactly the one from 2026-10-23_charge_exclusions.sql — only the
-- settings lookups gain "company_id = c.company_id".
do $$
declare
  sig regprocedure := 'public.estimate_fare(uuid, numeric, numeric, text, text, timestamptz, double precision, double precision, double precision, double precision, numeric)'::regprocedure;
  d text := pg_get_functiondef(sig);
  n int;
begin
  if position('company_id = c.company_id' in d) = 0 then
    n := (length(d) - length(replace(d, 'from app_settings where key = ', ''))) / length('from app_settings where key = ');
    if n <> 3 then
      raise exception 'estimate_fare changed shape (% settings lookups, expected 3) — nothing was changed', n;
    end if;
    execute replace(d, 'from app_settings where key = ', 'from app_settings where company_id = c.company_id and key = ');
  end if;
end $$;

-- Fixed routes: only the car class's own company's areas.
create or replace function public.find_fixed_route(
  p_category_id uuid,
  p_pickup_lat double precision, p_pickup_lng double precision,
  p_dropoff_lat double precision, p_dropoff_lng double precision
) returns jsonb language plpgsql stable set search_path to 'public' as $$
declare
  r record;
  v_company uuid;
begin
  if p_pickup_lat is null or p_pickup_lng is null or p_dropoff_lat is null or p_dropoff_lng is null then
    return null;
  end if;
  select company_id into v_company from vehicle_categories where id = p_category_id;
  if v_company is null then return null; end if;

  for r in
    select fr.id, fr.prices, fr.both_ways, fr.time_charges, fz.name as from_name, fz.polygon as from_poly,
           tz.name as to_name, tz.polygon as to_poly
      from fixed_routes fr
      join pricing_zones fz on fz.id = fr.from_zone_id and fz.is_active
      join pricing_zones tz on tz.id = fr.to_zone_id and tz.is_active
     where fr.is_active and fr.company_id = v_company
       and jsonb_typeof(fr.prices -> p_category_id::text) = 'number'
       and (fr.prices ->> p_category_id::text)::numeric > 0
     order by fr.sort_order asc, fr.created_at asc
  loop
    if point_in_zone(p_pickup_lat, p_pickup_lng, r.from_poly) and point_in_zone(p_dropoff_lat, p_dropoff_lng, r.to_poly) then
      return jsonb_build_object('route_id', r.id, 'name', r.from_name || ' → ' || r.to_name,
                                'price', (r.prices ->> p_category_id::text)::numeric,
                                'time_charges', r.time_charges);
    end if;
    if r.both_ways and point_in_zone(p_pickup_lat, p_pickup_lng, r.to_poly) and point_in_zone(p_dropoff_lat, p_dropoff_lng, r.from_poly) then
      return jsonb_build_object('route_id', r.id, 'name', r.to_name || ' → ' || r.from_name,
                                'price', (r.prices ->> p_category_id::text)::numeric,
                                'time_charges', r.time_charges);
    end if;
  end loop;
  return null;
end $$;

create or replace function public.quote_fares(
  p_api_key text,
  p_distance_km numeric default 0,
  p_duration_min numeric default 0,
  p_pickup text default '',
  p_dropoff text default '',
  p_at timestamptz default now(),
  p_route_text text default null,
  p_pickup_lat double precision default null,
  p_pickup_lng double precision default null,
  p_dropoff_lat double precision default null,
  p_dropoff_lng double precision default null,
  p_direct_km numeric default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  w websites%rowtype;
  v_quotes jsonb := '[]'::jsonb;
  c vehicle_categories%rowtype;
  v_child_price numeric;
  v_kw text := coalesce(nullif(trim(coalesce(p_route_text,'')),''), p_pickup || ' ' || p_dropoff);
begin
  select * into w from websites where api_key = p_api_key and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_website');
  end if;
  if not company_is_open(w.company_id) then
    return jsonb_build_object('ok', false, 'error', 'company_unavailable');
  end if;

  -- Whole pounds, like every fare.
  v_child_price := round(coalesce((select (value->>'amount')::numeric from app_settings
                                    where company_id = w.company_id and key = 'child_seat_price'), 0));

  for c in select * from vehicle_categories where company_id = w.company_id and is_active order by sort_order asc loop
    v_quotes := v_quotes || jsonb_build_object(
      'category_id', c.id,
      'name', c.name,
      'description', c.description,
      'icon', c.icon,
      'capacity', c.capacity,
      'suitcases', c.suitcases,
      'hand_bags', c.hand_bags,
      'fare', estimate_fare(c.id, p_distance_km, p_duration_min, v_kw, '', p_at,
                            p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng, p_direct_km)
    );
  end loop;

  return jsonb_build_object('ok', true, 'quotes', v_quotes, 'child_seat_price', v_child_price);
end; $function$;

create or replace function public.create_booking(
  p_api_key text, p_customer_name text, p_whatsapp text, p_pickup_address text, p_dropoff_address text,
  p_category_id uuid,
  p_pickup_lat double precision default null, p_pickup_lng double precision default null,
  p_dropoff_lat double precision default null, p_dropoff_lng double precision default null,
  p_distance_km numeric default 0, p_duration_min numeric default 0,
  p_payment_method payment_method default 'cash'::payment_method,
  p_notes text default null, p_scheduled_at timestamptz default null,
  p_via_points jsonb default '[]'::jsonb, p_trip_group_id uuid default null, p_is_return boolean default false,
  p_route_text text default null, p_email text default null, p_child_seat text default null,
  p_passengers integer default 1, p_suitcases integer default 0, p_hand_luggage integer default 0,
  p_direct_km numeric default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  w websites%rowtype;
  v_customer customers%rowtype;
  v_fare jsonb;
  v_total numeric;
  v_child_price numeric := 0;
  v_booking bookings%rowtype;
  v_min_adv int;
  v_plan plans%rowtype;
  v_email text := nullif(trim(coalesce(p_email,'')), '');
  v_child_seat boolean := nullif(trim(coalesce(p_child_seat,'')), '') is not null;
  v_kw text := coalesce(nullif(trim(coalesce(p_route_text,'')),''), p_pickup_address || ' ' || p_dropoff_address);
begin
  select * into w from websites where api_key = p_api_key and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_or_inactive_website');
  end if;
  if not company_is_open(w.company_id) then
    return jsonb_build_object('ok', false, 'error', 'company_unavailable');
  end if;
  if not exists (select 1 from vehicle_categories where id = p_category_id and company_id = w.company_id) then
    return jsonb_build_object('ok', false, 'error', 'invalid_category');
  end if;

  if p_customer_name is null or length(trim(p_customer_name)) = 0
     or p_whatsapp is null or length(trim(p_whatsapp)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'missing_customer_details');
  end if;

  -- Plan's monthly bookings (the return leg rides along with its outbound).
  if not coalesce(p_is_return, false) then
    select * into v_plan from company_plan(w.company_id);
    if found and v_plan.max_bookings_month is not null
       and company_bookings_this_month(w.company_id) >= v_plan.max_bookings_month then
      return jsonb_build_object('ok', false, 'error', 'plan_limit_bookings');
    end if;
  end if;

  -- Scheduled-time guard (skipped for immediate "now" bookings).
  if p_scheduled_at is not null then
    v_min_adv := coalesce((select (value->>'min_advance_minutes')::int from app_settings
                            where company_id = w.company_id and key = 'booking'), 30);
    if p_scheduled_at < now() + make_interval(mins => greatest(v_min_adv - 2, 0)) then
      return jsonb_build_object('ok', false, 'error', 'scheduled_too_soon');
    end if;
  end if;

  insert into customers(company_id, full_name, whatsapp, email)
  values (w.company_id, trim(p_customer_name), trim(p_whatsapp), v_email)
  on conflict (company_id, whatsapp) do update set
    full_name = excluded.full_name,
    email = coalesce(excluded.email, customers.email)
  returning * into v_customer;

  if v_customer.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'customer_blocked');
  end if;

  v_fare := estimate_fare(p_category_id, p_distance_km, p_duration_min, v_kw, '', coalesce(p_scheduled_at, now()),
                          p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng, p_direct_km);
  if v_fare ? 'error' then
    return jsonb_build_object('ok', false, 'error', 'invalid_category');
  end if;
  v_total := (v_fare->>'total')::numeric;

  -- Child seat is a one-off add-on: charge it once, on the outbound leg only.
  if v_child_seat and not coalesce(p_is_return, false) then
    v_child_price := round(coalesce((select (value->>'amount')::numeric from app_settings
                                      where company_id = w.company_id and key = 'child_seat_price'), 0));
    if v_child_price > 0 then
      v_total := v_total + v_child_price;
      v_fare := jsonb_set(v_fare, '{total}', to_jsonb(v_total));
      v_fare := jsonb_set(
        v_fare, '{extras}',
        coalesce(v_fare->'extras', '[]'::jsonb) ||
        jsonb_build_array(jsonb_build_object('name', 'Child seat', 'amount', v_child_price, 'type', 'fixed'))
      );
    end if;
  end if;

  insert into bookings(
    company_id, website_id, customer_id, customer_name, customer_whatsapp, customer_email,
    pickup_address, pickup_lat, pickup_lng,
    dropoff_address, dropoff_lat, dropoff_lng,
    vehicle_category_id, distance_km, duration_min,
    estimated_fare, fare_breakdown, payment_method, notes, child_seat,
    passengers, suitcases, hand_luggage, scheduled_at, status,
    via_points, trip_group_id, is_return
  ) values (
    w.company_id, w.id, v_customer.id, trim(p_customer_name), trim(p_whatsapp), v_email,
    p_pickup_address, p_pickup_lat, p_pickup_lng,
    p_dropoff_address, p_dropoff_lat, p_dropoff_lng,
    p_category_id, p_distance_km, p_duration_min,
    v_total, v_fare, p_payment_method, p_notes, v_child_seat,
    greatest(coalesce(p_passengers, 1), 1), greatest(coalesce(p_suitcases, 0), 0), greatest(coalesce(p_hand_luggage, 0), 0),
    p_scheduled_at, 'pending',
    coalesce(p_via_points, '[]'::jsonb), p_trip_group_id, coalesce(p_is_return, false)
  ) returning * into v_booking;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'booking_number', v_booking.booking_number,
    'estimated_fare', v_total,
    'fare_breakdown', v_fare,
    'website', w.name,
    'company_id', w.company_id
  );
end; $function$;

-- Staff-only actions now run as the signed-in user, so row-level security
-- (own company only) applies inside them as it does everywhere else.
alter function public.complete_ride(uuid, numeric, boolean) security invoker;
alter function public.delete_driver(uuid) security invoker;
alter function public.settle_driver_cash(uuid, text) security invoker;
alter function public.revenue_stats(integer) security invoker;

-- Outside bookings: run as the user, and one customer record per phone number
-- per company.
do $$
declare
  r record;
  d text;
begin
  for r in select p.oid from pg_proc p where p.proname = 'create_external_booking' and p.pronamespace = 'public'::regnamespace loop
    d := pg_get_functiondef(r.oid);
    d := replace(d, 'on conflict (whatsapp)', 'on conflict (company_id, whatsapp)');
    d := replace(d, 'SECURITY DEFINER', 'SECURITY INVOKER');
    execute d;
  end loop;
end $$;

-- Database → app calls go to the platform's own URLs (one app for everyone).
do $$
declare
  f text;
  d text;
begin
  foreach f in array array['notify_booking_change', 'run_booking_reminders'] loop
    d := pg_get_functiondef(('public.' || f)::regproc);
    if position('from app_settings where key = ''webhooks''' in d) > 0 then
      execute replace(d, 'from app_settings where key = ''webhooks''', 'from platform_settings where key = ''webhooks''');
    end if;
  end loop;
end $$;

-- ── 9. Row-level security: own company only ──────────────────────────────────
alter table public.plans             enable row level security;
alter table public.companies         enable row level security;
alter table public.platform_admins   enable row level security;
alter table public.platform_settings enable row level security;
alter table public.secrets           enable row level security;
alter table public.setup_requests    enable row level security;
alter table public.restore_requests  enable row level security;
alter table public.company_backups   enable row level security;
alter table public.platform_audit    enable row level security;
alter table public.pricing_zones     enable row level security;
alter table public.fixed_routes      enable row level security;

-- Start clean: drop every policy on the company tables, then add them back.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
     where schemaname = 'public' and tablename in (
       'profiles', 'websites', 'vehicle_categories', 'pricing_bands', 'pricing_rules', 'drivers',
       'vehicles', 'customers', 'bookings', 'payments', 'checkout_drafts', 'stripe_events',
       'ride_events', 'ratings', 'cash_settlements', 'activity_logs', 'app_settings',
       'push_subscriptions', 'driver_locations', 'staff_notifications', 'pricing_zones', 'fixed_routes',
       'plans', 'companies', 'platform_admins', 'platform_settings', 'secrets',
       'setup_requests', 'restore_requests', 'company_backups', 'platform_audit')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- Office staff (admin/dispatcher) of the company: everything on these tables.
do $$
declare t text;
begin
  foreach t in array array[
    'websites', 'vehicle_categories', 'pricing_bands', 'pricing_rules', 'drivers', 'vehicles',
    'customers', 'bookings', 'payments', 'ride_events', 'ratings', 'cash_settlements',
    'app_settings', 'pricing_zones', 'fixed_routes'
  ] loop
    execute format(
      'create policy "company_staff_all" on public.%I for all to authenticated
         using (company_id = current_company_id() and is_staff())
         with check (company_id = current_company_id() and is_staff())', t);
  end loop;
end $$;

-- Read-only for staff.
create policy "company_staff_read" on public.activity_logs for select to authenticated
  using (company_id = current_company_id() and is_staff());
create policy "company_staff_read" on public.driver_locations for select to authenticated
  using (company_id = current_company_id() and is_staff());
create policy "company_staff_read" on public.staff_notifications for select to authenticated
  using (company_id = current_company_id() and is_staff());

-- Anyone in the company (drivers too) may read its car classes and settings.
create policy "company_member_read" on public.vehicle_categories for select to authenticated
  using (company_id = current_company_id());
create policy "company_member_read" on public.app_settings for select to authenticated
  using (company_id = current_company_id());

-- Drivers: their own record, jobs, car, ratings, cash and the job history.
create policy "driver_self_read" on public.drivers for select to authenticated
  using (profile_id = auth.uid() and company_id = current_company_id());
create policy "driver_jobs_read" on public.bookings for select to authenticated
  using (driver_id is not null and driver_id = current_driver_id());
create policy "driver_vehicle_read" on public.vehicles for select to authenticated
  using (driver_id = current_driver_id());
create policy "driver_ratings_read" on public.ratings for select to authenticated
  using (driver_id = current_driver_id());
create policy "driver_cash_read" on public.cash_settlements for select to authenticated
  using (driver_id = current_driver_id());
create policy "driver_payments_read" on public.payments for select to authenticated
  using (booking_id in (select id from bookings where driver_id = current_driver_id()));
create policy "driver_events_read" on public.ride_events for select to authenticated
  using (booking_id in (select id from bookings where driver_id = current_driver_id()));

-- Staff logins: admins manage their own company's; everyone can read their own.
create policy "company_admin_all" on public.profiles for all to authenticated
  using (company_id = current_company_id() and is_admin())
  with check (company_id = current_company_id() and is_admin());
create policy "company_staff_read" on public.profiles for select to authenticated
  using (company_id = current_company_id() and is_staff());
create policy "self_read" on public.profiles for select to authenticated
  using (id = auth.uid());
create policy "self_update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Their own company row (name, plan, status) — read only.
create policy "own_company_read" on public.companies for select to authenticated
  using (id = (select company_id from profiles where id = auth.uid()));
create policy "public_plans_read" on public.plans for select to anon, authenticated
  using (is_active and is_public);
create policy "company_staff_read" on public.setup_requests for select to authenticated
  using (company_id = current_company_id() and is_staff());
create policy "company_staff_read" on public.restore_requests for select to authenticated
  using (company_id = current_company_id() and is_staff());
create policy "company_staff_read" on public.company_backups for select to authenticated
  using (company_id = current_company_id() and is_admin());

-- checkout_drafts, stripe_events, push_subscriptions, secrets, platform_*:
-- no policies on purpose — only the app's server (service role) may touch them.

-- A profile can't be moved to another company, nor made active in a suspended one.
create or replace function public.guard_profile_company()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is not null and not is_platform_admin() and new.company_id <> current_company_id() then
    raise exception 'Not your company';
  end if;
  return new;
end $$;
drop trigger if exists b_guard_profile_company on public.profiles;
create trigger b_guard_profile_company before insert or update on public.profiles
  for each row execute function public.guard_profile_company();

-- ── 10. Grants and checks ────────────────────────────────────────────────────
grant execute on function public.current_company_id() to anon, authenticated, service_role;
grant execute on function public.is_platform_admin() to authenticated, service_role;
grant execute on function public.company_usage(uuid) to service_role;
grant execute on function public.seed_company(uuid) to service_role;
-- Internal helpers: the app's server and the database itself only.
revoke execute on function public.seed_company(uuid) from anon, authenticated, public;
revoke execute on function public.company_usage(uuid) from anon, authenticated, public;
revoke execute on function public.company_plan(uuid) from anon, authenticated, public;
revoke execute on function public.company_bookings_this_month(uuid) from anon, authenticated, public;
revoke execute on function public.company_is_open(uuid) from anon, authenticated, public;
revoke execute on function public.sync_driver_availability(uuid) from anon, authenticated, public;
revoke execute on function public.run_booking_reminders() from anon, authenticated, public;
grant execute on function public.company_plan(uuid), public.company_bookings_this_month(uuid),
  public.company_is_open(uuid) to service_role;

-- Add the platform owner: create the login in Supabase → Authentication →
-- Users first, then run   select platform_add_owner('you@example.com');
create or replace function public.platform_add_owner(p_email text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v uuid;
begin
  select id into v from auth.users where lower(email) = lower(trim(p_email));
  if v is null then
    return 'No login with that email yet. Create it in Supabase → Authentication → Users, then run this again.';
  end if;
  insert into platform_admins (user_id) values (v) on conflict do nothing;
  return 'Done: ' || p_email || ' is a platform owner.';
end $$;
revoke execute on function public.platform_add_owner(text) from anon, authenticated, public;

do $$
declare f text; n int;
begin
  foreach f in array array['estimate_fare', 'quote_fares', 'create_booking', 'find_fixed_route'] loop
    select count(*) into n from pg_proc where proname = f and pronamespace = 'public'::regnamespace;
    if n <> 1 then
      raise exception 'Expected one public.% but found % — nothing was changed.', f, n;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
