-- ═════════════════════════════════════════════════════════════════════════════
-- Dispatch platform — the WHOLE database in one file.
--
-- Run ONCE on a new, empty Supabase project: SQL Editor → New query → paste
-- all of this → Run. Generated from the files in db/ (in this order):
--   00_schema.sql
--   01_functions.sql
--   2026-09-15_external_bookings.sql
--   02_seed.sql
--   2026-09-05_pricing_base_plus_bands.sql
--   2026-09-12_external_driver.sql
--   2026-09-12_stripe_checkout.sql
--   2026-09-12_stripe_hardening.sql
--   2026-09-15_external_bookings.sql
--   2026-09-28_distance_bands_add_up.sql
--   2026-10-09_job_status.sql
--   2026-10-13_ride_thank_you.sql
--   2026-10-13_driver_app.sql
--   2026-10-15_reminders.sql
--   2026-10-15_scheduled_jobs.sql
--   2026-10-15_notifications.sql
--   2026-10-19_fixed_prices.sql
--   2026-10-22_route_night_rate.sql
--   2026-10-23_charge_exclusions.sql
--   2026-10-24_platform.sql
--   2026-10-26_sync_job_status.sql
--   2026-10-27_manual_billing.sql
-- Do not edit here — edit those files and regenerate.
-- ═════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════ 00_schema.sql ══════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- TaxiFlow — complete database schema
--
-- Everything a FRESH Supabase project needs to run this app: types, tables,
-- keys, indexes, functions, triggers and row-level security. Run this once on
-- an empty project, then run any dated migration files in db/ that are newer
-- than this dump.
--
-- Why this file exists: the repo only ever carried the incremental changes, so
-- the real shape of the database lived nowhere but inside one Supabase project.
-- Standing up a second instance was impossible without it.
--
-- Generated from the original project, 2026-09-23.
-- ─────────────────────────────────────────────────────────────────────────────

-- Supabase provides this schema; gen_random_bytes() lives there.
create extension if not exists pgcrypto with schema extensions;

-- ── Types ────────────────────────────────────────────────────────────────────
do $$ begin
  create type public.booking_status as enum ('pending', 'assigned', 'accepted', 'driver_arrived', 'in_progress', 'completed', 'cancelled', 'declined', 'no_driver_found');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.charge_type as enum ('fixed', 'percentage');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.driver_availability as enum ('offline', 'online', 'on_trip');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.payment_method as enum ('cash', 'card');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.payment_status as enum ('pending', 'paid', 'failed', 'refunded');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.user_role as enum ('driver', 'dispatcher', 'admin');
exception when duplicate_object then null; end $$;

-- Booking numbers read TX<date>-<n>-<random>; this sequence is the <n>.
create sequence if not exists public.booking_seq start with 1001;

-- ── Tables ───────────────────────────────────────────────────────────────────
-- Staff logins. One row per auth.users row; the role here is what the admin and
-- dispatch areas gate on.
create table if not exists public.profiles (
  id uuid not null,
  full_name text default ''::text not null,
  email text,
  phone text,
  role user_role default 'dispatcher'::user_role not null,
  avatar_url text,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Each site the booking widget is embedded on. api_key is what the widget sends.
create table if not exists public.websites (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  domain text,
  color text default '#F5B301'::text,
  api_key text default encode(extensions.gen_random_bytes(16), 'hex'::text) not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null
);

-- Classes of car (Saloon, Estate, Executive…) and their base pricing.
create table if not exists public.vehicle_categories (
  id uuid default gen_random_uuid() not null,
  name text not null,
  description text,
  icon text default 'car'::text,
  capacity integer default 4 not null,
  base_fare numeric(10,2) default 0 not null,
  price_per_km numeric(10,2) default 0 not null,
  price_per_minute numeric(10,2) default 0 not null,
  minimum_fare numeric(10,2) default 0 not null,
  sort_order integer default 0 not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  suitcases integer default 2 not null,
  hand_bags integer default 2 not null
);

-- Tapered distance pricing: each band charges only the part of the trip that
-- falls inside it, income-tax-bracket style.
create table if not exists public.pricing_bands (
  id uuid default gen_random_uuid() not null,
  category_id uuid not null,
  from_km numeric default 0 not null,
  to_km numeric not null,
  price_per_km numeric default 0 not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

-- Surcharges: airport keyword, night hours, and so on.
create table if not exists public.pricing_rules (
  id uuid default gen_random_uuid() not null,
  name text not null,
  charge_type charge_type default 'fixed'::charge_type not null,
  amount numeric(10,2) default 0 not null,
  applies_all boolean default false not null,
  keyword text,
  start_time time without time zone,
  end_time time without time zone,
  category_id uuid,
  is_active boolean default true not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

-- Drivers are records notified over WhatsApp — they have no login of their own.
create table if not exists public.drivers (
  id uuid default gen_random_uuid() not null,
  profile_id uuid,
  full_name text not null,
  phone text,
  whatsapp text,
  license_number text,
  availability driver_availability default 'offline'::driver_availability not null,
  current_lat double precision,
  current_lng double precision,
  last_location_at timestamp with time zone,
  rating numeric(3,2) default 5.0 not null,
  total_trips integer default 0 not null,
  is_approved boolean default false not null,
  is_blocked boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  email text,
  service_area text
);

create table if not exists public.vehicles (
  id uuid default gen_random_uuid() not null,
  driver_id uuid,
  category_id uuid,
  make text,
  model text,
  color text,
  license_plate text,
  year integer,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null
);

-- One row per phone number: a repeat caller keeps one record and one history.
create table if not exists public.customers (
  id uuid default gen_random_uuid() not null,
  full_name text not null,
  whatsapp text not null,
  email text,
  is_blocked boolean default false not null,
  total_rides integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

-- A return trip is two rows sharing a trip_group_id. external_* columns hold a
-- job handed to an outside driver or arranged off-platform entirely.
create table if not exists public.bookings (
  id uuid default gen_random_uuid() not null,
  booking_number text,
  website_id uuid,
  customer_id uuid,
  customer_name text not null,
  customer_whatsapp text not null,
  pickup_address text not null,
  pickup_lat double precision,
  pickup_lng double precision,
  dropoff_address text not null,
  dropoff_lat double precision,
  dropoff_lng double precision,
  vehicle_category_id uuid,
  distance_km numeric(10,2),
  duration_min numeric(10,2),
  estimated_fare numeric(10,2),
  final_fare numeric(10,2),
  fare_breakdown jsonb,
  payment_method payment_method default 'cash'::payment_method not null,
  payment_status payment_status default 'pending'::payment_status not null,
  status booking_status default 'pending'::booking_status not null,
  driver_id uuid,
  dispatcher_id uuid,
  scheduled_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  assigned_at timestamp with time zone,
  accepted_at timestamp with time zone,
  arrived_at timestamp with time zone,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  via_points jsonb default '[]'::jsonb not null,
  trip_group_id uuid,
  is_return boolean default false not null,
  customer_email text,
  child_seat boolean default false not null,
  passengers integer default 1 not null,
  suitcases integer default 0 not null,
  hand_luggage integer default 0 not null,
  stripe_payment_intent_id text,
  cash_settled boolean default false not null,
  cash_settled_at timestamp with time zone,
  external_driver_name text,
  external_driver_phone text,
  external_driver_company text,
  external_vehicle_category_id uuid,
  external_vehicle_make text,
  external_vehicle_model text,
  external_vehicle_color text,
  external_vehicle_plate text,
  external_provider text
);

-- The money ledger: card through Stripe, cash closed by a dispatcher, and
-- off-platform jobs entered by staff all land here.
create table if not exists public.payments (
  id uuid default gen_random_uuid() not null,
  booking_id uuid,
  amount numeric(10,2) not null,
  method payment_method not null,
  status payment_status default 'pending'::payment_status not null,
  created_at timestamp with time zone default now() not null,
  stripe_payment_intent_id text,
  receipt_url text,
  refunded_at timestamp with time zone,
  currency text default 'gbp'::text not null,
  amount_refunded numeric default 0 not null,
  needs_review boolean default false not null,
  review_reason text,
  failure_reason text,
  disputed_at timestamp with time zone,
  alerted_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null
);

-- Booking requests parked while the customer pays on Stripe Checkout. Not
-- bookings — nothing here is dispatched.
create table if not exists public.checkout_drafts (
  id uuid default gen_random_uuid() not null,
  session_id text not null,
  payment_intent_id text,
  payload jsonb not null,
  amount numeric not null,
  currency text default 'gbp'::text not null,
  website_slug text,
  status text default 'open'::text not null,
  booking_id uuid,
  booking_number text,
  customer_email text,
  created_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  expires_at timestamp with time zone default (now() + '00:30:00'::interval) not null,
  quote_sig text
);

-- One row per Stripe webhook event: insert-first gives exactly-once processing.
create table if not exists public.stripe_events (
  id text not null,
  type text not null,
  received_at timestamp with time zone default now() not null,
  processed_at timestamp with time zone,
  error text
);

create table if not exists public.ride_events (
  id uuid default gen_random_uuid() not null,
  booking_id uuid,
  status booking_status not null,
  note text,
  actor text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.ratings (
  id uuid default gen_random_uuid() not null,
  booking_id uuid,
  driver_id uuid,
  rating integer not null,
  comment text,
  created_at timestamp with time zone default now() not null
);

-- Cash handed back to the office by a driver, settled in a batch.
create table if not exists public.cash_settlements (
  id uuid default gen_random_uuid() not null,
  driver_id uuid,
  amount numeric not null,
  ride_count integer not null,
  note text,
  settled_by uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.activity_logs (
  id uuid default gen_random_uuid() not null,
  actor_id uuid,
  actor_name text,
  actor_role text,
  action text not null,
  description text not null,
  metadata jsonb,
  created_at timestamp with time zone default now() not null
);

-- Non-secret, admin-editable config as jsonb: company, notifications, booking…
create table if not exists public.app_settings (
  key text not null,
  value jsonb not null,
  updated_at timestamp with time zone default now() not null
);

-- ── Keys and constraints ─────────────────────────────────────────────────────
alter table public.activity_logs     add constraint activity_logs_pkey PRIMARY KEY (id);
alter table public.app_settings      add constraint app_settings_pkey PRIMARY KEY (key);
alter table public.bookings          add constraint bookings_pkey PRIMARY KEY (id);
alter table public.cash_settlements  add constraint cash_settlements_pkey PRIMARY KEY (id);
alter table public.checkout_drafts   add constraint checkout_drafts_pkey PRIMARY KEY (id);
alter table public.customers         add constraint customers_pkey PRIMARY KEY (id);
alter table public.drivers           add constraint drivers_pkey PRIMARY KEY (id);
alter table public.payments          add constraint payments_pkey PRIMARY KEY (id);
alter table public.pricing_bands     add constraint pricing_bands_pkey PRIMARY KEY (id);
alter table public.pricing_rules     add constraint pricing_rules_pkey PRIMARY KEY (id);
alter table public.profiles          add constraint profiles_pkey PRIMARY KEY (id);
alter table public.ratings           add constraint ratings_pkey PRIMARY KEY (id);
alter table public.ride_events       add constraint ride_events_pkey PRIMARY KEY (id);
alter table public.stripe_events     add constraint stripe_events_pkey PRIMARY KEY (id);
alter table public.vehicle_categories add constraint vehicle_categories_pkey PRIMARY KEY (id);
alter table public.vehicles          add constraint vehicles_pkey PRIMARY KEY (id);
alter table public.websites          add constraint websites_pkey PRIMARY KEY (id);

alter table public.bookings        add constraint bookings_booking_number_key UNIQUE (booking_number);
alter table public.checkout_drafts add constraint checkout_drafts_session_id_key UNIQUE (session_id);
alter table public.customers       add constraint customers_whatsapp_key UNIQUE (whatsapp);
alter table public.websites        add constraint websites_api_key_key UNIQUE (api_key);
alter table public.websites        add constraint websites_slug_key UNIQUE (slug);

-- A job belongs to one of our drivers OR an outside driver, never both.
alter table public.bookings add constraint bookings_one_driver_only
  CHECK (((driver_id IS NULL) OR (external_driver_name IS NULL)));
alter table public.ratings  add constraint ratings_rating_check CHECK (((rating >= 1) AND (rating <= 5)));

alter table public.bookings add constraint bookings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);
alter table public.bookings add constraint bookings_dispatcher_id_fkey FOREIGN KEY (dispatcher_id) REFERENCES profiles(id);
alter table public.bookings add constraint bookings_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id);
alter table public.bookings add constraint bookings_external_vehicle_category_id_fkey FOREIGN KEY (external_vehicle_category_id) REFERENCES vehicle_categories(id) ON DELETE SET NULL;
alter table public.bookings add constraint bookings_vehicle_category_id_fkey FOREIGN KEY (vehicle_category_id) REFERENCES vehicle_categories(id);
alter table public.bookings add constraint bookings_website_id_fkey FOREIGN KEY (website_id) REFERENCES websites(id);
alter table public.cash_settlements add constraint cash_settlements_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL;
alter table public.checkout_drafts add constraint checkout_drafts_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
alter table public.drivers add constraint drivers_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.payments add constraint payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
alter table public.pricing_bands add constraint pricing_bands_category_id_fkey FOREIGN KEY (category_id) REFERENCES vehicle_categories(id) ON DELETE CASCADE;
alter table public.pricing_rules add constraint pricing_rules_category_id_fkey FOREIGN KEY (category_id) REFERENCES vehicle_categories(id);
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.ratings add constraint ratings_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
alter table public.ratings add constraint ratings_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id);
alter table public.ride_events add constraint ride_events_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
alter table public.vehicles add constraint vehicles_category_id_fkey FOREIGN KEY (category_id) REFERENCES vehicle_categories(id);
alter table public.vehicles add constraint vehicles_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists activity_logs_created_idx ON public.activity_logs USING btree (created_at DESC);
create index if not exists bookings_external_driver_idx ON public.bookings USING btree (external_driver_name) WHERE (external_driver_name IS NOT NULL);
create index if not exists bookings_external_provider_idx ON public.bookings USING btree (external_provider) WHERE (external_provider IS NOT NULL);
create index if not exists checkout_drafts_pi_idx ON public.checkout_drafts USING btree (payment_intent_id);
create index if not exists checkout_drafts_reuse_idx ON public.checkout_drafts USING btree (quote_sig, status) WHERE (status = 'open'::text);
create index if not exists checkout_drafts_status_idx ON public.checkout_drafts USING btree (status, created_at DESC);
create index if not exists idx_bookings_created ON public.bookings USING btree (created_at DESC);
create index if not exists idx_bookings_driver ON public.bookings USING btree (driver_id);
create index if not exists idx_bookings_status ON public.bookings USING btree (status);
create index if not exists idx_bookings_trip_group ON public.bookings USING btree (trip_group_id);
create index if not exists idx_bookings_website ON public.bookings USING btree (website_id);
create index if not exists idx_drivers_availability ON public.drivers USING btree (availability);
create index if not exists idx_ride_events_booking ON public.ride_events USING btree (booking_id);
create index if not exists idx_vehicles_driver ON public.vehicles USING btree (driver_id);
create index if not exists payments_booking_idx ON public.payments USING btree (booking_id);
create index if not exists payments_review_idx ON public.payments USING btree (needs_review, created_at DESC);
create index if not exists pricing_bands_category_from_idx ON public.pricing_bands USING btree (category_id, from_km);

-- One PaymentIntent can only ever be credited to one booking. This is the
-- database-level backstop for the replay guard in the app.
create unique index if not exists payments_stripe_payment_intent_id_key
  ON public.payments USING btree (stripe_payment_intent_id)
  WHERE (stripe_payment_intent_id IS NOT NULL);

-- ── Extensions used by the schema ────────────────────────────────────────────
create extension if not exists cube with schema extensions;
create extension if not exists earthdistance with schema extensions;

-- ── Helper functions ─────────────────────────────────────────────────────────
-- Role checks used throughout row-level security.
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists(select 1 from profiles
    where id = auth.uid() and is_active and role = 'admin');
$function$;

CREATE OR REPLACE FUNCTION public.is_staff()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists(select 1 from profiles
    where id = auth.uid() and is_active and role in ('dispatcher','admin'));
$function$;

CREATE OR REPLACE FUNCTION public.current_driver_id()
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select id from drivers where profile_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.log_activity(p_action text, p_description text, p_meta jsonb DEFAULT NULL::jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_name text; v_role text;
begin
  select full_name, role::text into v_name, v_role from profiles where id = auth.uid();
  insert into activity_logs(actor_id, actor_name, actor_role, action, description, metadata)
  values (auth.uid(), v_name, v_role, p_action, p_description, p_meta);
end; $function$;

-- ── Trigger functions ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin new.updated_at = now(); return new; end; $function$;

CREATE OR REPLACE FUNCTION public.touch_payments_updated_at()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_booking_number()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin
  if new.booking_number is null then
    new.booking_number := 'TX' || to_char(now(),'YYMMDD') || '-'
      || nextval('booking_seq') || '-'
      || upper(encode(extensions.gen_random_bytes(3), 'hex'));
  end if;
  return new;
end; $function$;

-- Timestamps each status change onto its own column.
CREATE OR REPLACE FUNCTION public.stamp_booking_status()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin
  if (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    case new.status
      when 'assigned'       then new.assigned_at  = now();
      when 'accepted'       then new.accepted_at  = now();
      when 'driver_arrived' then new.arrived_at   = now();
      when 'in_progress'    then new.started_at   = now();
      when 'completed'      then new.completed_at = now();
      when 'cancelled'      then new.cancelled_at = now();
      else null;
    end case;
  end if;
  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.log_ride_event()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if (tg_op = 'INSERT') then
    insert into ride_events(booking_id, status, note) values (new.id, new.status, 'Booking created');
  elsif (new.status is distinct from old.status) then
    insert into ride_events(booking_id, status) values (new.id, new.status);
  end if;
  return null;
end; $function$;

-- NOTE: fires on UPDATE only. A booking inserted as already-completed must bump
-- these counters itself (see create_external_booking).
CREATE OR REPLACE FUNCTION public.on_ride_completed()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if (new.status = 'completed' and old.status is distinct from 'completed') then
    if new.driver_id is not null then
      update drivers set total_trips = total_trips + 1 where id = new.driver_id;
    end if;
    if new.customer_id is not null then
      update customers set total_rides = total_rides + 1 where id = new.customer_id;
    end if;
  end if;
  return null;
end; $function$;

-- Nobody promotes themselves: role and is_active may only be changed by an
-- admin, or by the trusted service-role client (where auth.uid() is null).
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if (new.role is distinct from old.role)
     or (new.is_active is distinct from old.is_active) then
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'Not authorized to change role or active status';
    end if;
  end if;
  return new;
end;
$function$;

-- ── Staff actions ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_ride(p_booking_id uuid, p_final_fare numeric DEFAULT NULL::numeric, p_cash_received boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  b bookings%rowtype;
  v_fare numeric;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into b from bookings where id = p_booking_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_fare := coalesce(p_final_fare, b.final_fare, b.estimated_fare);

  update bookings set
    status = 'completed',
    final_fare = v_fare,
    payment_status = case
      when b.payment_method = 'cash' and p_cash_received then 'paid'::payment_status
      else payment_status end
  where id = p_booking_id;

  -- Record the cash payment once (mirrors how card payments are logged).
  if b.payment_method = 'cash' and p_cash_received
     and not exists (select 1 from payments where booking_id = p_booking_id) then
    insert into payments(booking_id, amount, method, status)
    values (p_booking_id, v_fare, 'cash', 'paid');
  end if;

  return jsonb_build_object('ok', true);
end; $function$;

CREATE OR REPLACE FUNCTION public.delete_driver(p_driver_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'dispatcher')) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  update bookings set driver_id = null where driver_id = p_driver_id;
  update ratings set driver_id = null where driver_id = p_driver_id;
  delete from drivers where id = p_driver_id;

  return jsonb_build_object('ok', true);
end; $function$;


-- ══════════════════════════════ 01_functions.sql ══════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- TaxiFlow — business logic, triggers and row-level security
--
-- Run AFTER db/00_schema.sql on a fresh Supabase project.
-- Generated from the original project, 2026-09-23.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Pricing ──────────────────────────────────────────────────────────────────
-- total = base fare + distance bands + extra charges.
CREATE OR REPLACE FUNCTION public.estimate_fare(p_category_id uuid, p_distance_km numeric, p_duration_min numeric, p_pickup text DEFAULT ''::text, p_dropoff text DEFAULT ''::text, p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
declare
  c            vehicle_categories%rowtype;
  v_base       numeric := 0;
  v_dist       numeric := 0;
  v_subtotal   numeric := 0;
  v_extras     jsonb   := '[]'::jsonb;
  v_extra_sum  numeric := 0;
  r            record;
  v_add        numeric;
  v_route      text;
  v_now_t      time;
  v_hit        boolean;
  v_tz         text;
  v_seg        numeric;
  b            record;
  v_add_up     boolean;
  v_rate       numeric;
begin
  select * into c from vehicle_categories where id = p_category_id;
  if not found then
    return jsonb_build_object('error','invalid_category');
  end if;

  v_base := coalesce(c.base_fare,0);

  -- Admin → Pricing "Add up distance bands" (app_settings.distance_bands.add_up,
  -- on when missing).
  select coalesce((value->>'add_up')::boolean, true) into v_add_up
    from app_settings where key = 'distance_bands';
  if v_add_up is null then v_add_up := true; end if;

  if v_add_up then
    -- Each band charges just the portion of the trip inside it, income-tax-bracket
    -- style. A category with no bands charges nothing for distance.
    for b in
      select from_km, to_km, price_per_km
      from pricing_bands where category_id = p_category_id
      order by from_km asc
    loop
      v_seg := least(coalesce(p_distance_km,0), b.to_km) - b.from_km;
      if v_seg > 0 then
        v_dist := v_dist + v_seg * coalesce(b.price_per_km,0);
      end if;
    end loop;
  else
    -- The whole trip at the rate of the band it ends in: 15 mi in "10-25 @ 4.5"
    -- is 15 × 4.5. Past the last band, the last band's rate carries on.
    select price_per_km into v_rate
      from pricing_bands
      where category_id = p_category_id and from_km < coalesce(p_distance_km,0)
      order by from_km desc
      limit 1;
    v_dist := coalesce(p_distance_km,0) * coalesce(v_rate,0);
  end if;

  v_subtotal := v_base + v_dist;
  v_route := lower(coalesce(p_pickup,'') || ' ' || coalesce(p_dropoff,''));

  select coalesce(value->>'timezone', 'Europe/London') into v_tz from app_settings where key = 'company';
  if v_tz is null then v_tz := 'Europe/London'; end if;
  v_now_t := (p_at at time zone v_tz)::time;

  -- Extra charges (airport keyword, night window, always-on). A percentage
  -- charge is a % of base + distance.
  for r in
    select * from pricing_rules
    where is_active and (category_id is null or category_id = p_category_id)
    order by sort_order asc
  loop
    v_hit := false;
    if r.applies_all then
      v_hit := true;
    elsif r.keyword is not null and r.keyword <> '' and v_route like '%' || lower(r.keyword) || '%' then
      v_hit := true;
    elsif r.start_time is not null and r.end_time is not null then
      if r.start_time <= r.end_time then
        v_hit := v_now_t >= r.start_time and v_now_t < r.end_time;
      else
        v_hit := v_now_t >= r.start_time or v_now_t < r.end_time;
      end if;
    end if;

    if v_hit then
      if r.charge_type = 'percentage' then
        v_add := round(v_subtotal * r.amount / 100.0, 2);
      else
        v_add := r.amount;
      end if;
      v_extra_sum := v_extra_sum + v_add;
      v_extras := v_extras || jsonb_build_object('name', r.name, 'amount', v_add, 'type', r.charge_type);
    end if;
  end loop;

  return jsonb_build_object(
    'category',      c.name,
    'base_fare',     round(v_base,2),
    'distance_cost', round(v_dist,2),
    'extras',        v_extras,
    'extras_total',  round(v_extra_sum,2),
    'total',         round(v_subtotal + v_extra_sum, 2)
  );
end; $function$;

-- Prices every active car class at once, for the booking widget.
CREATE OR REPLACE FUNCTION public.quote_fares(p_api_key text, p_distance_km numeric DEFAULT 0, p_duration_min numeric DEFAULT 0, p_pickup text DEFAULT ''::text, p_dropoff text DEFAULT ''::text, p_at timestamp with time zone DEFAULT now(), p_route_text text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  w websites%rowtype;
  v_quotes jsonb := '[]'::jsonb;
  c vehicle_categories%rowtype;
  v_child_price numeric := coalesce((select (value->>'amount')::numeric from app_settings where key = 'child_seat_price'), 0);
  v_kw text := coalesce(nullif(trim(coalesce(p_route_text,'')),''), p_pickup || ' ' || p_dropoff);
begin
  select * into w from websites where api_key = p_api_key and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_website');
  end if;

  for c in select * from vehicle_categories where is_active order by sort_order asc loop
    v_quotes := v_quotes || jsonb_build_object(
      'category_id', c.id,
      'name', c.name,
      'description', c.description,
      'icon', c.icon,
      'capacity', c.capacity,
      'suitcases', c.suitcases,
      'hand_bags', c.hand_bags,
      'fare', estimate_fare(c.id, p_distance_km, p_duration_min, v_kw, '', p_at)
    );
  end loop;

  return jsonb_build_object('ok', true, 'quotes', v_quotes, 'child_seat_price', v_child_price);
end; $function$;

-- ── Booking ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_booking(p_api_key text, p_customer_name text, p_whatsapp text, p_pickup_address text, p_dropoff_address text, p_category_id uuid, p_pickup_lat double precision DEFAULT NULL::double precision, p_pickup_lng double precision DEFAULT NULL::double precision, p_dropoff_lat double precision DEFAULT NULL::double precision, p_dropoff_lng double precision DEFAULT NULL::double precision, p_distance_km numeric DEFAULT 0, p_duration_min numeric DEFAULT 0, p_payment_method payment_method DEFAULT 'cash'::payment_method, p_notes text DEFAULT NULL::text, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_via_points jsonb DEFAULT '[]'::jsonb, p_trip_group_id uuid DEFAULT NULL::uuid, p_is_return boolean DEFAULT false, p_route_text text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_child_seat text DEFAULT NULL::text, p_passengers integer DEFAULT 1, p_suitcases integer DEFAULT 0, p_hand_luggage integer DEFAULT 0)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  w websites%rowtype;
  v_customer customers%rowtype;
  v_fare jsonb;
  v_total numeric;
  v_child_price numeric := 0;
  v_booking bookings%rowtype;
  v_min_adv int;
  v_email text := nullif(trim(coalesce(p_email,'')), '');
  v_child_seat boolean := nullif(trim(coalesce(p_child_seat,'')), '') is not null;
  v_kw text := coalesce(nullif(trim(coalesce(p_route_text,'')),''), p_pickup_address || ' ' || p_dropoff_address);
begin
  select * into w from websites where api_key = p_api_key and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_or_inactive_website');
  end if;

  if p_customer_name is null or length(trim(p_customer_name)) = 0
     or p_whatsapp is null or length(trim(p_whatsapp)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'missing_customer_details');
  end if;

  -- Scheduled-time guard (skipped for immediate "now" bookings).
  if p_scheduled_at is not null then
    v_min_adv := coalesce((select (value->>'min_advance_minutes')::int from app_settings where key = 'booking'), 30);
    if p_scheduled_at < now() + make_interval(mins => greatest(v_min_adv - 2, 0)) then
      return jsonb_build_object('ok', false, 'error', 'scheduled_too_soon');
    end if;
  end if;

  insert into customers(full_name, whatsapp, email)
  values (trim(p_customer_name), trim(p_whatsapp), v_email)
  on conflict (whatsapp) do update set
    full_name = excluded.full_name,
    email = coalesce(excluded.email, customers.email)
  returning * into v_customer;

  if v_customer.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'customer_blocked');
  end if;

  v_fare := estimate_fare(p_category_id, p_distance_km, p_duration_min, v_kw, '', coalesce(p_scheduled_at, now()));
  if v_fare ? 'error' then
    return jsonb_build_object('ok', false, 'error', 'invalid_category');
  end if;
  v_total := (v_fare->>'total')::numeric;

  -- Child seat is a one-off add-on: charge it once, on the outbound leg only.
  if v_child_seat and not coalesce(p_is_return, false) then
    v_child_price := coalesce((select (value->>'amount')::numeric from app_settings where key = 'child_seat_price'), 0);
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
    website_id, customer_id, customer_name, customer_whatsapp, customer_email,
    pickup_address, pickup_lat, pickup_lng,
    dropoff_address, dropoff_lat, dropoff_lng,
    vehicle_category_id, distance_km, duration_min,
    estimated_fare, fare_breakdown, payment_method, notes, child_seat,
    passengers, suitcases, hand_luggage, scheduled_at, status,
    via_points, trip_group_id, is_return
  ) values (
    w.id, v_customer.id, trim(p_customer_name), trim(p_whatsapp), v_email,
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
    'website', w.name
  );
end; $function$;

-- What the customer sees on the public tracking page.
CREATE OR REPLACE FUNCTION public.get_ride_status(p_booking_number text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  b bookings%rowtype;
  drv drivers%rowtype;
  veh vehicles%rowtype;
  ev jsonb;
  rated boolean;
  linked text;
begin
  select * into b from bookings where booking_number = p_booking_number;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if b.driver_id is not null then
    select * into drv from drivers where id = b.driver_id;
    select * into veh from vehicles where driver_id = b.driver_id and is_active limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('status', status, 'at', created_at) order by created_at), '[]'::jsonb)
    into ev from ride_events where booking_id = b.id;

  select exists(select 1 from ratings where booking_id = b.id) into rated;

  if b.trip_group_id is not null then
    select booking_number into linked
    from bookings where trip_group_id = b.trip_group_id and id <> b.id limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'booking_number', b.booking_number,
    'status', b.status,
    'customer_name', b.customer_name,
    'pickup_address', b.pickup_address,
    'dropoff_address', b.dropoff_address,
    'via_points', b.via_points,
    'is_return', b.is_return,
    'linked_booking', linked,
    'estimated_fare', b.estimated_fare,
    'payment_method', b.payment_method,
    'created_at', b.created_at,
    'scheduled_at', b.scheduled_at,
    'driver', case when drv.id is not null then jsonb_build_object(
        'name', drv.full_name,
        'phone', drv.phone,
        'rating', drv.rating,
        'vehicle', case when veh.id is not null
          then trim(coalesce(veh.color,'') || ' ' || coalesce(veh.make,'') || ' ' || coalesce(veh.model,''))
          else null end,
        'plate', veh.license_plate
      ) else null end,
    'events', ev,
    'rated', rated
  );
end; $function$;

CREATE OR REPLACE FUNCTION public.submit_rating(p_booking_number text, p_rating integer, p_comment text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  b bookings%rowtype;
  avg_r numeric;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return jsonb_build_object('ok', false, 'error', 'invalid_rating');
  end if;
  select * into b from bookings where booking_number = p_booking_number;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if b.status <> 'completed' then
    return jsonb_build_object('ok', false, 'error', 'not_completed');
  end if;
  if exists(select 1 from ratings where booking_id = b.id) then
    return jsonb_build_object('ok', false, 'error', 'already_rated');
  end if;

  insert into ratings(booking_id, driver_id, rating, comment)
  values (b.id, b.driver_id, p_rating, nullif(trim(coalesce(p_comment,'')), ''));

  if b.driver_id is not null then
    select round(avg(rating), 2) into avg_r from ratings where driver_id = b.driver_id;
    update drivers set rating = coalesce(avg_r, 5.0) where id = b.driver_id;
  end if;

  return jsonb_build_object('ok', true);
end; $function$;

-- ── Cash and reporting ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_driver_cash(p_driver_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_amount numeric;
  v_count int;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select coalesce(sum(coalesce(final_fare, estimated_fare)), 0), count(*)
    into v_amount, v_count
  from bookings
  where driver_id = p_driver_id and payment_method = 'cash'
    and payment_status = 'paid' and status = 'completed'
    and coalesce(cash_settled, false) = false;

  if v_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'nothing_to_settle');
  end if;

  update bookings set cash_settled = true, cash_settled_at = now()
  where driver_id = p_driver_id and payment_method = 'cash'
    and payment_status = 'paid' and status = 'completed'
    and coalesce(cash_settled, false) = false;

  insert into cash_settlements(driver_id, amount, ride_count, note, settled_by)
  values (p_driver_id, v_amount, v_count, nullif(trim(coalesce(p_note, '')), ''), auth.uid());

  return jsonb_build_object('ok', true, 'amount', v_amount, 'count', v_count);
end; $function$;

CREATE OR REPLACE FUNCTION public.revenue_stats(p_days integer DEFAULT 7)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_tz text;
  v_total numeric;
  v_completed int;
  v_total_bookings int;
  v_series jsonb;
begin
  if not is_staff() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select coalesce(value->>'timezone', 'Europe/London') into v_tz from app_settings where key = 'company';
  if v_tz is null then v_tz := 'Europe/London'; end if;

  select coalesce(sum(coalesce(final_fare, estimated_fare)), 0), count(*)
    into v_total, v_completed
  from bookings where status = 'completed';

  select count(*) into v_total_bookings from bookings;

  with dseries as (
    select (date_trunc('day', (now() at time zone v_tz)) - make_interval(days => g))::date as d
    from generate_series(0, greatest(p_days, 1) - 1) g
  ),
  daily as (
    select ((completed_at at time zone v_tz)::date) as d,
           sum(coalesce(final_fare, estimated_fare)) as revenue,
           count(*) as cnt
    from bookings
    where status = 'completed' and completed_at is not null
      and (completed_at at time zone v_tz)::date
          >= (date_trunc('day', now() at time zone v_tz) - make_interval(days => greatest(p_days,1) - 1))::date
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'd', to_char(ds.d, 'YYYY-MM-DD'),
      'revenue', round(coalesce(dl.revenue, 0), 2),
      'count', coalesce(dl.cnt, 0)
    ) order by ds.d), '[]'::jsonb)
    into v_series
  from dseries ds left join daily dl on dl.d = ds.d;

  return jsonb_build_object(
    'ok', true,
    'total_revenue', round(v_total, 2),
    'completed_count', v_completed,
    'total_bookings', v_total_bookings,
    'avg_fare', case when v_completed > 0 then round(v_total / v_completed, 2) else 0 end,
    'series', v_series
  );
end; $function$;

-- ── Triggers ─────────────────────────────────────────────────────────────────
drop trigger if exists trg_booking_number on public.bookings;
CREATE TRIGGER trg_booking_number BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION set_booking_number();
drop trigger if exists trg_bookings_updated on public.bookings;
CREATE TRIGGER trg_bookings_updated BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists trg_log_ride_event on public.bookings;
CREATE TRIGGER trg_log_ride_event AFTER INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION log_ride_event();
drop trigger if exists trg_ride_completed on public.bookings;
CREATE TRIGGER trg_ride_completed AFTER UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION on_ride_completed();
drop trigger if exists trg_stamp_booking on public.bookings;
CREATE TRIGGER trg_stamp_booking BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION stamp_booking_status();
drop trigger if exists trg_drivers_updated on public.drivers;
CREATE TRIGGER trg_drivers_updated BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists payments_touch_updated_at on public.payments;
CREATE TRIGGER payments_touch_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION touch_payments_updated_at();
drop trigger if exists trg_profiles_guard_privileged on public.profiles;
CREATE TRIGGER trg_profiles_guard_privileged BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_privileged_columns();
drop trigger if exists trg_profiles_updated on public.profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Row level security ───────────────────────────────────────────────────────
-- checkout_drafts and stripe_events get RLS with NO policies on purpose: only
-- the service role (which bypasses RLS) may touch them.
alter table public.activity_logs      enable row level security;
alter table public.app_settings       enable row level security;
alter table public.bookings           enable row level security;
alter table public.cash_settlements   enable row level security;
alter table public.checkout_drafts    enable row level security;
alter table public.customers          enable row level security;
alter table public.drivers            enable row level security;
alter table public.payments           enable row level security;
alter table public.pricing_bands      enable row level security;
alter table public.pricing_rules      enable row level security;
alter table public.profiles           enable row level security;
alter table public.ratings            enable row level security;
alter table public.ride_events        enable row level security;
alter table public.stripe_events      enable row level security;
alter table public.vehicle_categories enable row level security;
alter table public.vehicles           enable row level security;
alter table public.websites           enable row level security;

create policy "logs_staff_read" on public.activity_logs as PERMISSIVE for SELECT to authenticated using (is_staff());
create policy "settings_admin_write" on public.app_settings as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "settings_public_read" on public.app_settings as PERMISSIVE for SELECT to anon, authenticated using (true);
create policy "bookings_staff_all" on public.bookings as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "settlements_staff_read" on public.cash_settlements as PERMISSIVE for SELECT to authenticated using (is_staff());
create policy "settlements_staff_write" on public.cash_settlements as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "customers_staff_read" on public.customers as PERMISSIVE for SELECT to authenticated using (is_staff());
create policy "customers_staff_write" on public.customers as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "drivers_admin_write" on public.drivers as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "drivers_read" on public.drivers as PERMISSIVE for SELECT to authenticated using ((is_staff() OR (profile_id = auth.uid())));
create policy "payments_read" on public.payments as PERMISSIVE for SELECT to authenticated using ((is_staff() OR (booking_id IN ( SELECT bookings.id FROM bookings WHERE (bookings.driver_id = current_driver_id())))));
create policy "payments_staff_write" on public.payments as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "bands_public_read" on public.pricing_bands as PERMISSIVE for SELECT to anon, authenticated using (true);
create policy "bands_staff_write" on public.pricing_bands as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "pricing_admin_write" on public.pricing_rules as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "pricing_staff_read" on public.pricing_rules as PERMISSIVE for SELECT to authenticated using (is_staff());
create policy "profiles_admin_write" on public.profiles as PERMISSIVE for ALL to authenticated using (is_admin()) with check (is_admin());
create policy "profiles_self_read" on public.profiles as PERMISSIVE for SELECT to authenticated using (((id = auth.uid()) OR is_staff()));
create policy "profiles_self_update" on public.profiles as PERMISSIVE for UPDATE to authenticated using ((id = auth.uid()));
create policy "ratings_staff_read" on public.ratings as PERMISSIVE for SELECT to authenticated using ((is_staff() OR (driver_id = current_driver_id())));
create policy "ratings_staff_write" on public.ratings as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "events_read" on public.ride_events as PERMISSIVE for SELECT to authenticated using ((is_staff() OR (booking_id IN ( SELECT bookings.id FROM bookings WHERE (bookings.driver_id = current_driver_id())))));
create policy "events_staff_write" on public.ride_events as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "cat_admin_write" on public.vehicle_categories as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "cat_public_read" on public.vehicle_categories as PERMISSIVE for SELECT to anon, authenticated using (true);
create policy "vehicles_admin_write" on public.vehicles as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "vehicles_read" on public.vehicles as PERMISSIVE for SELECT to authenticated using ((is_staff() OR (driver_id = current_driver_id())));
create policy "sites_admin_write" on public.websites as PERMISSIVE for ALL to authenticated using (is_staff()) with check (is_staff());
create policy "sites_staff_read" on public.websites as PERMISSIVE for SELECT to authenticated using (is_staff());


-- ══════════════════════════════ 2026-09-15_external_bookings.sql ══════════════════════════════

-- Off-platform bookings (2026-09-15)
--
-- A customer rings up, none of our drivers are free, so the office books them a
-- ride on Uber (or Bolt, or a partner firm) and charges the customer directly.
-- The website was never involved, so that job exists nowhere in the system —
-- and the day's takings are wrong.
--
-- This lets staff enter that job afterwards, back-dated, with the fare the
-- customer actually paid and the status it actually ended in. Everything else
-- behaves like a normal booking: same numbering, same customer record, same
-- place in the lists and the takings.
begin;

alter table public.bookings add column if not exists external_provider text;

comment on column public.bookings.external_provider is
  'Which outside service ran this job (Uber, Bolt, a partner firm). Non-null marks a booking that was arranged off-platform and entered by staff afterwards.';

create index if not exists bookings_external_provider_idx
  on public.bookings (external_provider)
  where external_provider is not null;

/**
 * Write a booking that happened outside the app.
 *
 * Deliberately NOT create_booking(): that one prices the trip itself and
 * refuses a start time in the past, both of which are wrong here. The fare is
 * whatever the customer was actually charged, and the ride may well have
 * finished yesterday.
 */
create or replace function public.create_external_booking(
  p_customer_name   text,
  p_whatsapp        text,
  p_pickup_address  text,
  p_dropoff_address text,
  p_fare            numeric,
  p_occurred_at     timestamptz,
  p_status          booking_status  default 'pending',
  p_payment_method  payment_method  default 'cash',
  p_payment_status  payment_status  default 'pending',
  p_provider        text            default null,
  p_email           text            default null,
  p_category_id     uuid            default null,
  p_notes           text            default null,
  p_passengers      integer         default 1
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_customer customers%rowtype;
  v_booking  bookings%rowtype;
  v_email    text := nullif(trim(coalesce(p_email, '')), '');
  -- Non-null marks the booking as off-platform; the form doesn't ask which
  -- service was used, so a constant stands in.
  v_provider text := coalesce(nullif(trim(coalesce(p_provider, '')), ''), 'Outside');
  v_when     timestamptz := coalesce(p_occurred_at, now());
begin
  if p_customer_name is null or length(trim(p_customer_name)) = 0
     or p_whatsapp is null or length(trim(p_whatsapp)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'missing_customer_details');
  end if;

  if p_pickup_address is null or length(trim(p_pickup_address)) = 0
     or p_dropoff_address is null or length(trim(p_dropoff_address)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'missing_route');
  end if;

  if p_fare is null or p_fare < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_fare');
  end if;

  -- Same upsert as a normal booking, so a caller who has rung before keeps one
  -- customer record and their ride history stays in one place.
  insert into customers(full_name, whatsapp, email)
  values (trim(p_customer_name), trim(p_whatsapp), v_email)
  on conflict (whatsapp) do update set
    full_name = excluded.full_name,
    email     = coalesce(excluded.email, customers.email)
  returning * into v_customer;

  if v_customer.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'customer_blocked');
  end if;

  insert into bookings(
    customer_id, customer_name, customer_whatsapp, customer_email,
    pickup_address, dropoff_address, via_points,
    vehicle_category_id, estimated_fare, final_fare, fare_breakdown,
    payment_method, payment_status, status, notes, passengers,
    scheduled_at, external_provider, completed_at, cancelled_at
  ) values (
    v_customer.id, trim(p_customer_name), trim(p_whatsapp), v_email,
    trim(p_pickup_address), trim(p_dropoff_address), '[]'::jsonb,
    p_category_id, p_fare,
    -- A finished job's takings are settled, so final_fare is known already.
    case when p_status = 'completed' then p_fare else null end,
    jsonb_build_object('total', p_fare, 'external', true, 'note', 'Arranged outside the app'),
    p_payment_method, p_payment_status, p_status, p_notes,
    greatest(coalesce(p_passengers, 1), 1),
    v_when, v_provider,
    case when p_status = 'completed' then v_when else null end,
    case when p_status = 'cancelled' then v_when else null end
  ) returning * into v_booking;

  -- Money that has already been collected belongs in the payments ledger, the
  -- same as a cash ride closed by a dispatcher or a card ride paid on Stripe.
  -- Without this an outside job counted in revenue but appeared nowhere in
  -- Payments, and the two screens disagreed.
  if p_payment_status = 'paid' then
    insert into payments(booking_id, amount, method, status)
    values (v_booking.id, p_fare, p_payment_method, 'paid');
  end if;

  -- The "ride completed" trigger only fires on UPDATE, so a job entered as
  -- already-completed would never be counted on the customer's record.
  if p_status = 'completed' then
    update customers set total_rides = total_rides + 1 where id = v_customer.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'booking_number', v_booking.booking_number,
    'fare', p_fare
  );
end;
$function$;

-- Staff-only: the API route checks the session and calls this with the service
-- role. Nothing public may reach it, or anyone could invent paid bookings.
revoke all on function public.create_external_booking(
  text, text, text, text, numeric, timestamptz, booking_status, payment_method,
  payment_status, text, text, uuid, text, integer
) from public, anon, authenticated;

grant execute on function public.create_external_booking(
  text, text, text, text, numeric, timestamptz, booking_status, payment_method,
  payment_status, text, text, uuid, text, integer
) to service_role;

commit;


-- ══════════════════════════════ 02_seed.sql ══════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- TaxiFlow — starting data
--
-- Run AFTER 00_schema.sql and 01_functions.sql. Safe to re-run: every insert
-- is guarded, so nothing is duplicated and nothing already edited is trampled.
--
-- Car classes and pricing are copied from the original deployment as a sensible
-- starting point — change them in Admin → Pricing once the site is up.
--
-- Deliberately NOT here: `websites` (its api_key must be generated fresh for
-- each instance) and `profiles` (staff logins belong to whoever runs this one).
-- See db/README.md for how to create those.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Car classes ──────────────────────────────────────────────────────────────
insert into public.vehicle_categories (id, name, description, icon, capacity, suitcases, hand_bags, base_fare, sort_order, is_active) values
  ('416a93df-1973-48e7-aa5d-8291de223f05', 'Saloon',    'Comfortable everyday ride, up to 4 passengers', 'car',       4, 2, 2, 2.50, 0, true),
  ('55655e85-b250-40a8-8ce8-372e401673e1', 'Estate',    null,                                            'car',       5, 4, 3, 3.50, 1, true),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6', 'Executive', 'Premium car with professional driver',          'car-front', 4, 3, 3, 5.00, 2, true),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b', 'MPV',       null,                                            'car-front', 6, 4, 4, 4.00, 3, true),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3', '8 Seater',  'Spacious van for groups & luggage, up to 8',    'bus',       8, 6, 6, 4.00, 4, true)
on conflict (id) do nothing;

-- ── Distance bands ───────────────────────────────────────────────────────────
-- Tapered: each band charges only the miles that fall inside it. Rates fall as
-- the journey gets longer, so a short hop is not priced like an airport run.
-- (The columns say "km" for historical reasons; the app works in MILES.)
insert into public.pricing_bands (category_id, from_km, to_km, price_per_km, sort_order)
select * from (values
  -- Saloon
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 0,  2,    10,   0),
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 2,  3,    10,   1),
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 3,  4,    8,    2),
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 4,  5,    6,    3),
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 5,  10,   5,    4),
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 10, 25,   4.5,  5),
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 25, 40,   3.5,  6),
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 40, 50,   3.2,  7),
  ('416a93df-1973-48e7-aa5d-8291de223f05'::uuid, 50, 1000, 3,    8),
  -- Estate
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 0,  2,    15,   0),
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 2,  3,    14,   1),
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 3,  4,    11,   2),
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 4,  5,    7,    3),
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 5,  10,   7,    4),
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 10, 25,   6,    5),
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 25, 40,   5,    6),
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 40, 50,   3.5,  7),
  ('55655e85-b250-40a8-8ce8-372e401673e1'::uuid, 50, 1000, 3.2,  8),
  -- Executive
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 0,  2,    15,   0),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 2,  3,    14,   1),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 3,  4,    11,   2),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 4,  5,    7,    3),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 5,  10,   7,    4),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 10, 25,   6,    5),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 25, 40,   5,    6),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 40, 50,   3.5,  7),
  ('e4abf54b-27a2-4dc4-b5d6-cfa1ea7c2ae6'::uuid, 50, 1000, 3.2,  8),
  -- MPV
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 0,  2,    15,   0),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 2,  3,    14,   1),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 3,  4,    11,   2),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 4,  5,    7,    3),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 5,  10,   7,    4),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 10, 25,   6,    5),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 25, 40,   5,    6),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 40, 50,   3.5,  7),
  ('71137eff-b87f-4b5c-84b4-de4817c0c81b'::uuid, 50, 1000, 3.2,  8),
  -- 8 Seater
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 0,  2,    18,   0),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 2,  3,    16,   1),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 3,  4,    14,   2),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 4,  5,    12,   3),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 5,  10,   10,   4),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 10, 25,   8,    5),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 25, 40,   7,    6),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 40, 50,   5,    7),
  ('04824d39-b2ec-43e5-a41a-db2124a473e3'::uuid, 50, 1000, 4,    8)
) as b(category_id, from_km, to_km, price_per_km, sort_order)
where not exists (select 1 from public.pricing_bands existing
                  where existing.category_id = b.category_id and existing.from_km = b.from_km);

-- ── Extra charges ────────────────────────────────────────────────────────────
insert into public.pricing_rules (name, charge_type, amount, applies_all, keyword, start_time, end_time, category_id, is_active, sort_order)
select * from (values
  ('Airport Surcharge',          'fixed'::charge_type,      10.00, false, 'airport'::text, null::time, null::time, null::uuid, true, 1),
  ('Night Surcharge (10pm-6am)', 'percentage'::charge_type, 20.00, false, null,            '22:00'::time, '06:00'::time, null::uuid, true, 2)
) as r(name, charge_type, amount, applies_all, keyword, start_time, end_time, category_id, is_active, sort_order)
where not exists (select 1 from public.pricing_rules existing where existing.name = r.name);

-- ── Settings ─────────────────────────────────────────────────────────────────
-- Blank where the value belongs to this instance: company name, sender
-- addresses and alert recipients are set in Admin → Settings once it is live.
-- `company.timezone`, `child_seat_price` and `distance_bands` are read by the pricing functions,
-- so they must exist from the start.
insert into public.app_settings (key, value) values
  ('company', jsonb_build_object(
      'name', 'Taxi Co',
      'currency', 'GBP',
      'currency_symbol', '£',
      'timezone', 'Europe/London',
      'distance_unit', 'miles',
      'support_whatsapp', '')),
  ('booking', jsonb_build_object(
      'allow_scheduled', true,
      'min_advance_minutes', 30)),
  ('child_seat_price', jsonb_build_object('amount', 5)),
  -- true = bands add up (tapered); false = whole trip at the rate of its band.
  ('distance_bands', jsonb_build_object('add_up', true)),
  -- `booking_alert_emails` is deliberately absent, not an empty list. The code
  -- reads an empty list as "tell nobody" -- a real choice an admin can make --
  -- and only falls back to every active admin and dispatcher when the key is
  -- missing entirely. Seeding [] would therefore start a new instance with
  -- booking alerts silently switched off. Set the real addresses in
  -- Admin -> Settings once the staff accounts exist.
  ('notifications', jsonb_build_object(
      'email_from', '',
      'sms_sender', '')),
  ('dispatch', jsonb_build_object(
      'auto_assign', false,
      'sound_alerts', true,
      'driver_accept_timeout_seconds', 15)),
  ('branding', jsonb_build_object('primary_color', '#F5B301', 'logo_url', '')),
  ('map', jsonb_build_object(
      'default_center_lat', 51.5074,
      'default_center_lng', -0.1278,
      'default_zoom', 12))
on conflict (key) do nothing;


-- ══════════════════════════════ 2026-09-05_pricing_base_plus_bands.sql ══════════════════════════════

-- Pricing simplification (2026-09-05, per boss):
--   total = base fare + tapered distance bands + extra charges (+ child seat, added by create_booking)
-- Per-minute cost and minimum fare are REMOVED. Distance is charged ONLY through
-- pricing_bands (the flat price_per_km column is no longer used).
begin;

create or replace function public.estimate_fare(
  p_category_id uuid,
  p_distance_km numeric,
  p_duration_min numeric,           -- kept for callers' compatibility; no longer priced
  p_pickup text default ''::text,
  p_dropoff text default ''::text,
  p_at timestamp with time zone default now()
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  c            vehicle_categories%rowtype;
  v_base       numeric := 0;
  v_dist       numeric := 0;
  v_subtotal   numeric := 0;
  v_extras     jsonb   := '[]'::jsonb;
  v_extra_sum  numeric := 0;
  r            record;
  v_add        numeric;
  v_route      text;
  v_now_t      time;
  v_hit        boolean;
  v_tz         text;
  v_seg        numeric;
  b            record;
begin
  select * into c from vehicle_categories where id = p_category_id;
  if not found then
    return jsonb_build_object('error','invalid_category');
  end if;

  v_base := coalesce(c.base_fare,0);

  -- Distance cost: tapered rate bands only. Each band charges just the portion
  -- of the trip that falls inside it (income-tax-bracket style). A category
  -- with no bands charges nothing for distance (admin UI warns about this).
  for b in
    select from_km, to_km, price_per_km
    from pricing_bands where category_id = p_category_id
    order by from_km asc
  loop
    v_seg := least(coalesce(p_distance_km,0), b.to_km) - b.from_km;
    if v_seg > 0 then
      v_dist := v_dist + v_seg * coalesce(b.price_per_km,0);
    end if;
  end loop;

  v_subtotal := v_base + v_dist;

  v_route := lower(coalesce(p_pickup,'') || ' ' || coalesce(p_dropoff,''));

  select coalesce(value->>'timezone', 'Europe/London') into v_tz from app_settings where key = 'company';
  if v_tz is null then v_tz := 'Europe/London'; end if;
  v_now_t := (p_at at time zone v_tz)::time;

  -- Extra charges (airport keyword, night window, always-on). Percentage
  -- charges are a % of base + distance.
  for r in
    select * from pricing_rules
    where is_active and (category_id is null or category_id = p_category_id)
    order by sort_order asc
  loop
    v_hit := false;
    if r.applies_all then
      v_hit := true;
    elsif r.keyword is not null and r.keyword <> '' and v_route like '%' || lower(r.keyword) || '%' then
      v_hit := true;
    elsif r.start_time is not null and r.end_time is not null then
      if r.start_time <= r.end_time then
        v_hit := v_now_t >= r.start_time and v_now_t < r.end_time;
      else
        v_hit := v_now_t >= r.start_time or v_now_t < r.end_time;
      end if;
    end if;

    if v_hit then
      if r.charge_type = 'percentage' then
        v_add := round(v_subtotal * r.amount / 100.0, 2);
      else
        v_add := r.amount;
      end if;
      v_extra_sum := v_extra_sum + v_add;
      v_extras := v_extras || jsonb_build_object('name', r.name, 'amount', v_add, 'type', r.charge_type);
    end if;
  end loop;

  return jsonb_build_object(
    'category',      c.name,
    'base_fare',     round(v_base,2),
    'distance_cost', round(v_dist,2),
    'extras',        v_extras,
    'extras_total',  round(v_extra_sum,2),
    'total',         round(v_subtotal + v_extra_sum, 2)
  );
end; $function$;

-- The flat per-mile, per-minute and minimum-fare columns are no longer priced.
-- Zero them so nothing stale can ever leak back in.
update vehicle_categories
   set price_per_km = 0, price_per_minute = 0, minimum_fare = 0;

commit;


-- ══════════════════════════════ 2026-09-12_external_driver.sql ══════════════════════════════

-- Outside / temporary drivers (2026-09-12)
--
-- When none of our own drivers are free, dispatch needs to hand the job to a
-- driver from another company for that ONE ride. Those drivers must not land in
-- Admin → Drivers: they are not ours, they have no rating, no settlement, no
-- vehicle record, and next week they may not exist at all.
--
-- So the details live on the booking itself, not in `drivers` / `vehicles`.
-- A booking is assigned to EITHER driver_id (ours) OR external_driver_name.
-- The vehicle columns mirror `vehicles` (make / model / color / license plate)
-- so the customer still sees which car is coming and its registration.
begin;

alter table public.bookings add column if not exists external_driver_name    text;
alter table public.bookings add column if not exists external_driver_phone   text;
alter table public.bookings add column if not exists external_driver_company text;

alter table public.bookings add column if not exists external_vehicle_category_id uuid
  references public.vehicle_categories(id) on delete set null;
alter table public.bookings add column if not exists external_vehicle_make   text;
alter table public.bookings add column if not exists external_vehicle_model  text;
alter table public.bookings add column if not exists external_vehicle_color  text;
alter table public.bookings add column if not exists external_vehicle_plate  text;

comment on column public.bookings.external_driver_name is
  'Outside driver this single ride was handed to. Set instead of driver_id; never creates a drivers row.';
comment on column public.bookings.external_driver_phone is
  'Contact number for the outside driver — used for the WhatsApp job message and the customer''s "call driver" button.';
comment on column public.bookings.external_driver_company is
  'Optional: which firm the outside driver came from, so it can be reconciled later.';
comment on column public.bookings.external_vehicle_category_id is
  'Class of car actually sent. Defaults to what the customer booked, but a partner may turn up in a different class.';
comment on column public.bookings.external_vehicle_plate is
  'Registration of the outside car, shown to the customer on the tracking page.';

-- A job cannot belong to one of our drivers and an outside driver at once.
alter table public.bookings drop constraint if exists bookings_one_driver_only;
alter table public.bookings add constraint bookings_one_driver_only
  check (driver_id is null or external_driver_name is null);

-- Finding "which jobs went outside" for reconciliation.
create index if not exists bookings_external_driver_idx
  on public.bookings (external_driver_name)
  where external_driver_name is not null;

commit;


-- ══════════════════════════════ 2026-09-12_stripe_checkout.sql ══════════════════════════════

-- Stripe Checkout: hosted payment page (2026-09-12)
--
-- The customer now leaves the site to pay on checkout.stripe.com, and the
-- booking is only written once Stripe confirms the money. That means the trip
-- details have to survive the round trip WITHOUT being a booking yet — otherwise
-- every abandoned checkout would leave junk on the dispatch board.
--
-- This table is that waiting room. A draft becomes a real booking exactly once:
-- whichever arrives first — the customer returning, or the webhook — creates it,
-- and `booking_id` makes the second one a no-op.
begin;

create table if not exists public.checkout_drafts (
  id                uuid primary key default gen_random_uuid(),
  -- Stripe Checkout Session. Unique = one session can only ever make one booking.
  session_id        text unique not null,
  payment_intent_id text,
  -- The whole validated booking request, replayed into create_booking on return.
  payload           jsonb       not null,
  -- Amount we priced server-side and asked Stripe to charge, in pounds.
  amount            numeric     not null,
  currency          text        not null default 'gbp',
  website_slug      text,
  -- Fingerprint of the priced trip: lets a customer who presses Pay again land
  -- back on the SAME Stripe session instead of opening a second one.
  quote_sig         text,
  -- open → completed (booking made) | expired (customer never paid)
  status            text        not null default 'open',
  booking_id        uuid references public.bookings(id) on delete set null,
  booking_number    text,
  customer_email    text,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  expires_at        timestamptz not null default (now() + interval '30 minutes')
);

comment on table public.checkout_drafts is
  'Booking requests parked while the customer pays on Stripe Checkout. Not bookings — nothing here is dispatched. Cleared by expiry.';
comment on column public.checkout_drafts.booking_id is
  'Set the moment the draft becomes a real booking. Non-null = already redeemed; both the return page and the webhook check this first.';

create index if not exists checkout_drafts_status_idx on public.checkout_drafts (status, created_at desc);
create index if not exists checkout_drafts_pi_idx     on public.checkout_drafts (payment_intent_id);
create index if not exists checkout_drafts_reuse_idx  on public.checkout_drafts (quote_sig, status) where status = 'open';

-- Service role only. The customer's own draft is read back through our API by
-- its unguessable id; nothing here is ever exposed to anon/authenticated.
alter table public.checkout_drafts enable row level security;

commit;


-- ══════════════════════════════ 2026-09-12_stripe_hardening.sql ══════════════════════════════

-- Stripe hardening (2026-09-12)
--
-- 1. payments.stripe_payment_intent_id becomes UNIQUE  → one PaymentIntent can
--    only ever be credited to ONE booking. This is the DB-level backstop for the
--    replay guard in /api/book (pay once, book many times).
-- 2. Review / orphan columns so a payment that arrives without a matching
--    booking (browser died mid-checkout) is visible instead of silently lost.
-- 3. stripe_events → webhook idempotency. Stripe retries deliveries; we must
--    process each event exactly once.
--
-- Safe to re-run. Existing duplicate PaymentIntent rows are NOT deleted — the
-- later copies are unlinked from the intent and flagged for review so the
-- unique index can be created without losing history.
begin;

-- ── 1. Extra columns on payments ────────────────────────────────────────────
alter table public.payments add column if not exists currency        text        not null default 'gbp';
alter table public.payments add column if not exists amount_refunded numeric     not null default 0;
alter table public.payments add column if not exists needs_review    boolean     not null default false;
alter table public.payments add column if not exists review_reason   text;
alter table public.payments add column if not exists failure_reason  text;
alter table public.payments add column if not exists disputed_at     timestamptz;
alter table public.payments add column if not exists alerted_at      timestamptz;
alter table public.payments add column if not exists updated_at      timestamptz not null default now();

comment on column public.payments.needs_review is
  'Money moved but something did not line up (orphan payment, amount/trip mismatch, reused intent). Staff must check and refund or attach manually.';
comment on column public.payments.alerted_at is
  'When the "unmatched payment" alert email was sent to staff. Null = not yet alerted.';

-- ── 2. De-duplicate before adding the unique index ──────────────────────────
-- Keep the OLDEST row per PaymentIntent. Later copies keep their booking link
-- and amount (history is preserved) but lose the intent id and are flagged.
with ranked as (
  select id,
         stripe_payment_intent_id,
         row_number() over (
           partition by stripe_payment_intent_id order by created_at asc, id asc
         ) as rn
  from public.payments
  where stripe_payment_intent_id is not null
)
update public.payments p
   set stripe_payment_intent_id = null,
       needs_review  = true,
       review_reason = coalesce(p.review_reason, '')
                     || 'Duplicate of PaymentIntent ' || r.stripe_payment_intent_id
                     || ' — this booking may have been credited without a separate payment. ',
       updated_at    = now()
  from ranked r
 where p.id = r.id
   and r.rn > 1;

create unique index if not exists payments_stripe_payment_intent_id_key
  on public.payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- Fast lookup for the orphan sweep + admin Payments page
create index if not exists payments_review_idx
  on public.payments (needs_review, created_at desc);
create index if not exists payments_booking_idx
  on public.payments (booking_id);

-- ── 3. Webhook event de-duplication ─────────────────────────────────────────
create table if not exists public.stripe_events (
  id            text primary key,               -- Stripe event id (evt_...)
  type          text        not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text
);

comment on table public.stripe_events is
  'One row per Stripe webhook event. Insert-first gives exactly-once processing: Stripe retries a delivery, the primary key rejects it, we return 200.';

-- Service role only (the webhook runs with the service key and bypasses RLS
-- anyway). No anon/authenticated policies → nothing is publicly readable.
alter table public.stripe_events enable row level security;

-- ── 4. Keep payments.updated_at fresh ───────────────────────────────────────
create or replace function public.touch_payments_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists payments_touch_updated_at on public.payments;
create trigger payments_touch_updated_at
  before update on public.payments
  for each row execute function public.touch_payments_updated_at();

commit;


-- ══════════════════════════════ 2026-09-15_external_bookings.sql ══════════════════════════════

-- Off-platform bookings (2026-09-15)
--
-- A customer rings up, none of our drivers are free, so the office books them a
-- ride on Uber (or Bolt, or a partner firm) and charges the customer directly.
-- The website was never involved, so that job exists nowhere in the system —
-- and the day's takings are wrong.
--
-- This lets staff enter that job afterwards, back-dated, with the fare the
-- customer actually paid and the status it actually ended in. Everything else
-- behaves like a normal booking: same numbering, same customer record, same
-- place in the lists and the takings.
begin;

alter table public.bookings add column if not exists external_provider text;

comment on column public.bookings.external_provider is
  'Which outside service ran this job (Uber, Bolt, a partner firm). Non-null marks a booking that was arranged off-platform and entered by staff afterwards.';

create index if not exists bookings_external_provider_idx
  on public.bookings (external_provider)
  where external_provider is not null;

/**
 * Write a booking that happened outside the app.
 *
 * Deliberately NOT create_booking(): that one prices the trip itself and
 * refuses a start time in the past, both of which are wrong here. The fare is
 * whatever the customer was actually charged, and the ride may well have
 * finished yesterday.
 */
create or replace function public.create_external_booking(
  p_customer_name   text,
  p_whatsapp        text,
  p_pickup_address  text,
  p_dropoff_address text,
  p_fare            numeric,
  p_occurred_at     timestamptz,
  p_status          booking_status  default 'pending',
  p_payment_method  payment_method  default 'cash',
  p_payment_status  payment_status  default 'pending',
  p_provider        text            default null,
  p_email           text            default null,
  p_category_id     uuid            default null,
  p_notes           text            default null,
  p_passengers      integer         default 1
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_customer customers%rowtype;
  v_booking  bookings%rowtype;
  v_email    text := nullif(trim(coalesce(p_email, '')), '');
  -- Non-null marks the booking as off-platform; the form doesn't ask which
  -- service was used, so a constant stands in.
  v_provider text := coalesce(nullif(trim(coalesce(p_provider, '')), ''), 'Outside');
  v_when     timestamptz := coalesce(p_occurred_at, now());
begin
  if p_customer_name is null or length(trim(p_customer_name)) = 0
     or p_whatsapp is null or length(trim(p_whatsapp)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'missing_customer_details');
  end if;

  if p_pickup_address is null or length(trim(p_pickup_address)) = 0
     or p_dropoff_address is null or length(trim(p_dropoff_address)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'missing_route');
  end if;

  if p_fare is null or p_fare < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_fare');
  end if;

  -- Same upsert as a normal booking, so a caller who has rung before keeps one
  -- customer record and their ride history stays in one place.
  insert into customers(full_name, whatsapp, email)
  values (trim(p_customer_name), trim(p_whatsapp), v_email)
  on conflict (whatsapp) do update set
    full_name = excluded.full_name,
    email     = coalesce(excluded.email, customers.email)
  returning * into v_customer;

  if v_customer.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'customer_blocked');
  end if;

  insert into bookings(
    customer_id, customer_name, customer_whatsapp, customer_email,
    pickup_address, dropoff_address, via_points,
    vehicle_category_id, estimated_fare, final_fare, fare_breakdown,
    payment_method, payment_status, status, notes, passengers,
    scheduled_at, external_provider, completed_at, cancelled_at
  ) values (
    v_customer.id, trim(p_customer_name), trim(p_whatsapp), v_email,
    trim(p_pickup_address), trim(p_dropoff_address), '[]'::jsonb,
    p_category_id, p_fare,
    -- A finished job's takings are settled, so final_fare is known already.
    case when p_status = 'completed' then p_fare else null end,
    jsonb_build_object('total', p_fare, 'external', true, 'note', 'Arranged outside the app'),
    p_payment_method, p_payment_status, p_status, p_notes,
    greatest(coalesce(p_passengers, 1), 1),
    v_when, v_provider,
    case when p_status = 'completed' then v_when else null end,
    case when p_status = 'cancelled' then v_when else null end
  ) returning * into v_booking;

  -- Money that has already been collected belongs in the payments ledger, the
  -- same as a cash ride closed by a dispatcher or a card ride paid on Stripe.
  -- Without this an outside job counted in revenue but appeared nowhere in
  -- Payments, and the two screens disagreed.
  if p_payment_status = 'paid' then
    insert into payments(booking_id, amount, method, status)
    values (v_booking.id, p_fare, p_payment_method, 'paid');
  end if;

  -- The "ride completed" trigger only fires on UPDATE, so a job entered as
  -- already-completed would never be counted on the customer's record.
  if p_status = 'completed' then
    update customers set total_rides = total_rides + 1 where id = v_customer.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'booking_number', v_booking.booking_number,
    'fare', p_fare
  );
end;
$function$;

-- Staff-only: the API route checks the session and calls this with the service
-- role. Nothing public may reach it, or anyone could invent paid bookings.
revoke all on function public.create_external_booking(
  text, text, text, text, numeric, timestamptz, booking_status, payment_method,
  payment_status, text, text, uuid, text, integer
) from public, anon, authenticated;

grant execute on function public.create_external_booking(
  text, text, text, text, numeric, timestamptz, booking_status, payment_method,
  payment_status, text, text, uuid, text, integer
) to service_role;

commit;


-- ══════════════════════════════ 2026-09-28_distance_bands_add_up.sql ══════════════════════════════

-- Distance bands: add up, or whole trip at one rate (2026-09-28)
--
-- Admin → Pricing gets an "Add up distance bands" checkbox.
--
--   ON  (default, same as before): every band charges the miles inside it and
--       they are added together. 15 mi Saloon = the first 10 mi at the
--       lower bands' rates + 5 mi at £4.50.
--   OFF: the whole trip is charged at the rate of the band it ends in.
--       15 mi Saloon in "10-25 @ £4.50" = 15 × £4.50.
--
-- The setting lives in app_settings under 'distance_bands'. When that row is
-- missing the function behaves exactly as before, so running this file changes
-- no price until an admin unticks the box.
--
-- Run once in the Supabase SQL editor of EACH instance. Safe to run twice.
begin;

insert into public.app_settings (key, value)
values ('distance_bands', jsonb_build_object('add_up', true))
on conflict (key) do nothing;

CREATE OR REPLACE FUNCTION public.estimate_fare(p_category_id uuid, p_distance_km numeric, p_duration_min numeric, p_pickup text DEFAULT ''::text, p_dropoff text DEFAULT ''::text, p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
declare
  c            vehicle_categories%rowtype;
  v_base       numeric := 0;
  v_dist       numeric := 0;
  v_subtotal   numeric := 0;
  v_extras     jsonb   := '[]'::jsonb;
  v_extra_sum  numeric := 0;
  r            record;
  v_add        numeric;
  v_route      text;
  v_now_t      time;
  v_hit        boolean;
  v_tz         text;
  v_seg        numeric;
  b            record;
  v_add_up     boolean;
  v_rate       numeric;
begin
  select * into c from vehicle_categories where id = p_category_id;
  if not found then
    return jsonb_build_object('error','invalid_category');
  end if;

  v_base := coalesce(c.base_fare,0);

  -- Admin → Pricing "Add up distance bands" (app_settings.distance_bands.add_up,
  -- on when missing).
  select coalesce((value->>'add_up')::boolean, true) into v_add_up
    from app_settings where key = 'distance_bands';
  if v_add_up is null then v_add_up := true; end if;

  if v_add_up then
    -- Each band charges just the portion of the trip inside it, income-tax-bracket
    -- style. A category with no bands charges nothing for distance.
    for b in
      select from_km, to_km, price_per_km
      from pricing_bands where category_id = p_category_id
      order by from_km asc
    loop
      v_seg := least(coalesce(p_distance_km,0), b.to_km) - b.from_km;
      if v_seg > 0 then
        v_dist := v_dist + v_seg * coalesce(b.price_per_km,0);
      end if;
    end loop;
  else
    -- The whole trip at the rate of the band it ends in: 15 mi in "10-25 @ 4.5"
    -- is 15 × 4.5. Past the last band, the last band's rate carries on.
    select price_per_km into v_rate
      from pricing_bands
      where category_id = p_category_id and from_km < coalesce(p_distance_km,0)
      order by from_km desc
      limit 1;
    v_dist := coalesce(p_distance_km,0) * coalesce(v_rate,0);
  end if;

  v_subtotal := v_base + v_dist;
  v_route := lower(coalesce(p_pickup,'') || ' ' || coalesce(p_dropoff,''));

  select coalesce(value->>'timezone', 'Europe/London') into v_tz from app_settings where key = 'company';
  if v_tz is null then v_tz := 'Europe/London'; end if;
  v_now_t := (p_at at time zone v_tz)::time;

  -- Extra charges (airport keyword, night window, always-on). A percentage
  -- charge is a % of base + distance.
  for r in
    select * from pricing_rules
    where is_active and (category_id is null or category_id = p_category_id)
    order by sort_order asc
  loop
    v_hit := false;
    if r.applies_all then
      v_hit := true;
    elsif r.keyword is not null and r.keyword <> '' and v_route like '%' || lower(r.keyword) || '%' then
      v_hit := true;
    elsif r.start_time is not null and r.end_time is not null then
      if r.start_time <= r.end_time then
        v_hit := v_now_t >= r.start_time and v_now_t < r.end_time;
      else
        v_hit := v_now_t >= r.start_time or v_now_t < r.end_time;
      end if;
    end if;

    if v_hit then
      if r.charge_type = 'percentage' then
        v_add := round(v_subtotal * r.amount / 100.0, 2);
      else
        v_add := r.amount;
      end if;
      v_extra_sum := v_extra_sum + v_add;
      v_extras := v_extras || jsonb_build_object('name', r.name, 'amount', v_add, 'type', r.charge_type);
    end if;
  end loop;

  return jsonb_build_object(
    'category',      c.name,
    'base_fare',     round(v_base,2),
    'distance_cost', round(v_dist,2),
    'extras',        v_extras,
    'extras_total',  round(v_extra_sum,2),
    'total',         round(v_subtotal + v_extra_sum, 2)
  );
end; $function$;

commit;


-- ══════════════════════════════ 2026-10-09_job_status.sql ══════════════════════════════

-- Job status (2026-10-09)
--
-- A manual, office-side status on every booking that admin and dispatch set by
-- hand: processing → on hold → completed / cancelled / refunded.
--
-- It sits ALONGSIDE bookings.status, not instead of it. bookings.status is the
-- ride's own lifecycle (pending → assigned → in progress → completed), driven
-- by the driver app and dispatch board; nothing here changes that.
--
-- "Refunded" is only a label: money goes back to the customer from the Stripe
-- Dashboard, and staff record it here.
--
-- Already folded into 00_schema.sql for new instances. Safe to re-run.
begin;

alter table public.bookings
  add column if not exists job_status text not null default 'processing';

alter table public.bookings drop constraint if exists bookings_job_status_check;
alter table public.bookings add constraint bookings_job_status_check
  check (job_status in ('processing', 'on_hold', 'completed', 'cancelled', 'refunded'));

comment on column public.bookings.job_status is
  'Office-side status set by admin/dispatch: processing, on_hold, completed, cancelled, refunded. Separate from status (the ride lifecycle).';

commit;


-- ══════════════════════════════ 2026-10-13_ride_thank_you.sql ══════════════════════════════

-- Thank-you email when a ride is completed (2026-10-13)
--
-- The moment a booking's status turns 'completed' — whether the admin panel,
-- the dispatch board or the driver app did it — the database calls the app,
-- which emails the customer a thank-you with a review link and the app link.
--
--   bookings.thanks_sent_at   set once the email has gone; it is the lock that
--                             makes sure each ride is thanked exactly once
--   notify_booking_completed  the trigger; it POSTs {"booking_id": …} to the
--                             URL in app_settings 'webhooks'.booking_status_url
--
-- Uses pg_net (Supabase's built-in HTTP extension). The call is asynchronous
-- and fire-and-forget: if it fails, the booking update still succeeds and the
-- daily sweep (/api/cron/keepalive) sends the email instead.
--
-- Safe to re-run.
begin;

create extension if not exists pg_net;

alter table public.bookings add column if not exists thanks_sent_at timestamptz;

comment on column public.bookings.thanks_sent_at is
  'When the "thanks for riding" email was sent. Null = not sent yet (or it failed and will be retried).';

-- Where the app lives. Change this if the dispatch moves to another domain.
insert into public.app_settings (key, value)
values ('webhooks', jsonb_build_object(
  'booking_status_url', 'https://dispatch.airport-transfer.uk/api/webhooks/booking-status'
))
on conflict (key) do nothing;

create or replace function public.notify_booking_completed()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_url text;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select value->>'booking_status_url' into v_url from app_settings where key = 'webhooks';
    if coalesce(v_url, '') <> '' then
      perform net.http_post(
        url     := v_url,
        body    := jsonb_build_object('booking_id', new.id),
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    end if;
  end if;
  return null;
exception when others then
  -- Never let an email problem stop a ride being completed.
  return null;
end;
$$;

drop trigger if exists trg_notify_booking_completed on public.bookings;
create trigger trg_notify_booking_completed
  after update of status on public.bookings
  for each row execute function public.notify_booking_completed();

-- Company name, and an SMS sender ID networks will accept (max 11
-- letters/digits — a long company name is too long). Only filled in where
-- still blank (or the "Taxi Co" placeholder): anything already set in
-- Admin → Settings is left alone.
update public.app_settings
   set value = jsonb_set(value, '{name}', '"Taxi Co"'), updated_at = now()
 where key = 'company' and coalesce(value->>'name', '') in ('', 'Taxi Co');
update public.app_settings
   set value = jsonb_set(value, '{sms_sender}', '"TaxiCo"'), updated_at = now()
 where key = 'notifications' and coalesce(value->>'sms_sender', '') = '';

commit;


-- ══════════════════════════════ 2026-10-13_driver_app.sql ══════════════════════════════

-- Driver app (2026-10-13)
--
-- Drivers get their own installable app (/driver): sign in, go online/offline,
-- share their live location, and move their own jobs along —
--   assigned → accepted ("On my way") → driver_arrived → in_progress → completed
-- Dispatch sees every driver on a map, and a driver who is on a job shows as
-- busy so they aren't given a second one.
--
-- Everything a driver can change goes through the security-definer functions
-- below, each of which only ever touches the signed-in driver's own row and
-- jobs. Drivers get READ access to their own bookings and nothing else.
--
-- Notifications (push to the driver on assignment, SMS to the customer on
-- arrival and completion) are sent by the app when the database tells it a
-- booking changed — see notify_booking_change. Each one is stamped on the
-- booking so it is sent exactly once.
--
-- Run after 2026-10-13_ride_thank_you.sql. Safe to re-run.
begin;

-- ── Columns ──────────────────────────────────────────────────────────────────
alter table public.bookings add column if not exists notified_driver_id uuid;
alter table public.bookings add column if not exists arrived_sms_at     timestamptz;
alter table public.bookings add column if not exists completed_sms_at   timestamptz;

comment on column public.bookings.notified_driver_id is
  'Driver who was last sent the "new job" push for this booking. Re-assigning to someone else sends a new one.';
comment on column public.bookings.arrived_sms_at is 'When the customer was texted that the driver has arrived.';
comment on column public.bookings.completed_sms_at is 'When the customer was texted that the ride is complete.';

-- ── Push subscriptions (one per driver device) ─────────────────────────────
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  driver_id   uuid not null references public.drivers(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_driver_idx on public.push_subscriptions (driver_id);
-- Service role only: the app's own API routes read and write this table.
alter table public.push_subscriptions enable row level security;

-- ── Drivers can read their own jobs ──────────────────────────────────────────
drop policy if exists "bookings_driver_read" on public.bookings;
create policy "bookings_driver_read" on public.bookings
  as permissive for select to authenticated
  using (driver_id is not null and driver_id = current_driver_id());

-- ── Busy / available follows the driver's jobs ──────────────────────────────
-- A driver is busy from "On my way" until the job is finished. Being merely
-- assigned (possibly hours ahead) does not make them busy. Only drivers who use
-- the app (have a login) are tracked this way.
create or replace function public.sync_driver_availability(p_driver uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_active boolean;
begin
  if p_driver is null then return; end if;
  select exists (
    select 1 from bookings
     where driver_id = p_driver and status in ('accepted', 'driver_arrived', 'in_progress')
  ) into v_active;
  if v_active then
    update drivers set availability = 'on_trip' where id = p_driver and profile_id is not null and availability <> 'on_trip';
  else
    update drivers set availability = 'online' where id = p_driver and profile_id is not null and availability = 'on_trip';
  end if;
end;
$$;

create or replace function public.trg_sync_driver_availability()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform sync_driver_availability(new.driver_id);
  if tg_op = 'UPDATE' and old.driver_id is distinct from new.driver_id then
    perform sync_driver_availability(old.driver_id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_bookings_driver_availability on public.bookings;
create trigger trg_bookings_driver_availability
  after insert or update of status, driver_id on public.bookings
  for each row execute function public.trg_sync_driver_availability();

-- ── What the driver app calls ────────────────────────────────────────────────
-- The signed-in driver's own record, with their car.
create or replace function public.driver_me()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'id', d.id, 'full_name', d.full_name, 'availability', d.availability,
    'is_blocked', d.is_blocked, 'is_approved', d.is_approved,
    'vehicle', (select jsonb_build_object('make', v.make, 'model', v.model, 'color', v.color, 'plate', v.license_plate)
                  from vehicles v where v.driver_id = d.id limit 1)
  )
  from drivers d where d.id = current_driver_id();
$$;

-- Go online / offline.
create or replace function public.driver_set_online(p_online boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_driver uuid := current_driver_id();
  v_state driver_availability;
begin
  if v_driver is null then return jsonb_build_object('ok', false, 'error', 'not_a_driver'); end if;
  if exists (select 1 from drivers where id = v_driver and (is_blocked or not is_approved)) then
    return jsonb_build_object('ok', false, 'error', 'blocked');
  end if;
  if p_online then
    update drivers set availability = 'online' where id = v_driver;
    perform sync_driver_availability(v_driver);
  else
    update drivers set availability = 'offline' where id = v_driver;
  end if;
  select availability into v_state from drivers where id = v_driver;
  return jsonb_build_object('ok', true, 'availability', v_state);
end;
$$;

-- Live location. Kept in its own small table — one row per driver, overwritten
-- in place — and deliberately NOT broadcast over realtime: the dispatch map
-- polls it every few seconds instead. Writing positions into `drivers` would
-- push a realtime event to every open dispatch screen on every update, which
-- is what eats a free-tier project's message allowance. The app only sends when
-- the driver has actually moved (or every few minutes as a heartbeat).
create table if not exists public.driver_locations (
  driver_id   uuid primary key references public.drivers(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  heading     double precision,
  speed_kmh   double precision,
  updated_at  timestamptz not null default now()
);
alter table public.driver_locations enable row level security;
drop policy if exists "driver_locations_staff_read" on public.driver_locations;
create policy "driver_locations_staff_read" on public.driver_locations
  as permissive for select to authenticated using (is_staff());

drop function if exists public.driver_update_location(double precision, double precision);
create or replace function public.driver_update_location(
  p_lat double precision,
  p_lng double precision,
  p_heading double precision default null,
  p_speed_kmh double precision default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_driver uuid := current_driver_id();
begin
  if v_driver is null or p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then return; end if;
  insert into driver_locations (driver_id, lat, lng, heading, speed_kmh, updated_at)
  values (v_driver, p_lat, p_lng, p_heading, p_speed_kmh, now())
  on conflict (driver_id) do update
    set lat = excluded.lat, lng = excluded.lng, heading = excluded.heading,
        speed_kmh = excluded.speed_kmh, updated_at = excluded.updated_at;
end;
$$;

-- Drivers can see their own cash settlements (the Cash tab in their app).
drop policy if exists "settlements_driver_read" on public.cash_settlements;
create policy "settlements_driver_read" on public.cash_settlements
  as permissive for select to authenticated
  using (driver_id is not null and driver_id = current_driver_id());

-- Move one of the driver's own jobs along.
--   accept   assigned            → accepted        ("On my way")
--   arrived  assigned / accepted → driver_arrived
--   start    driver_arrived      → in_progress     ("Passenger on board")
--   complete driver_arrived / in_progress → completed (cash recorded if collected)
--   decline  assigned / accepted → back to the dispatch queue, unassigned
create or replace function public.driver_job_action(p_booking_id uuid, p_action text, p_cash_received boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_driver uuid := current_driver_id();
  b bookings%rowtype;
  v_next booking_status;
  v_fare numeric;
begin
  if v_driver is null then return jsonb_build_object('ok', false, 'error', 'not_a_driver'); end if;

  select * into b from bookings where id = p_booking_id and driver_id = v_driver for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_your_job'); end if;

  if p_action = 'decline' then
    if b.status not in ('assigned', 'accepted') then
      return jsonb_build_object('ok', false, 'error', 'too_late_to_decline');
    end if;
    update bookings set driver_id = null, status = 'pending', notified_driver_id = null where id = b.id;
    insert into ride_events(booking_id, status, note)
      values (b.id, 'pending', 'Declined by driver — back in the dispatch queue');
    return jsonb_build_object('ok', true, 'status', 'pending');
  end if;

  v_next := case
    when p_action = 'accept'   and b.status = 'assigned'                                   then 'accepted'
    when p_action = 'arrived'  and b.status in ('assigned', 'accepted')                    then 'driver_arrived'
    when p_action = 'start'    and b.status = 'driver_arrived'                             then 'in_progress'
    when p_action = 'complete' and b.status in ('driver_arrived', 'in_progress')           then 'completed'
    else null
  end::booking_status;

  if v_next is null then
    return jsonb_build_object('ok', false, 'error', 'not_allowed_now', 'status', b.status);
  end if;

  if v_next = 'completed' then
    v_fare := coalesce(b.final_fare, b.estimated_fare);
    update bookings set
      status = 'completed',
      final_fare = v_fare,
      payment_status = case
        when b.payment_method = 'cash' and p_cash_received then 'paid'::payment_status
        else payment_status end
    where id = b.id;
    if b.payment_method = 'cash' and p_cash_received
       and not exists (select 1 from payments where booking_id = b.id) then
      insert into payments(booking_id, amount, method, status) values (b.id, v_fare, 'cash', 'paid');
    end if;
  else
    update bookings set status = v_next where id = b.id;
  end if;

  return jsonb_build_object('ok', true, 'status', v_next);
end;
$$;

grant execute on function public.driver_me() to authenticated;
grant execute on function public.driver_set_online(boolean) to authenticated;
grant execute on function public.driver_update_location(double precision, double precision, double precision, double precision) to authenticated;
grant execute on function public.driver_job_action(uuid, text, boolean) to authenticated;

-- ── Tell the app when a booking changes ─────────────────────────────────────
-- Replaces notify_booking_completed: also fires on assignment (driver push)
-- and on arrival (customer SMS). The app works out what is due and stamps it.
create or replace function public.notify_booking_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_url text;
begin
  if (new.status is distinct from old.status and new.status in ('assigned', 'driver_arrived', 'completed'))
     or (new.driver_id is distinct from old.driver_id and new.driver_id is not null) then
    select value->>'booking_status_url' into v_url from app_settings where key = 'webhooks';
    if coalesce(v_url, '') <> '' then
      perform net.http_post(
        url     := v_url,
        body    := jsonb_build_object('booking_id', new.id),
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    end if;
  end if;
  return null;
exception when others then
  -- Never let a notification problem stop a job moving.
  return null;
end;
$$;

drop trigger if exists trg_notify_booking_completed on public.bookings;
drop trigger if exists trg_notify_booking_change on public.bookings;
create trigger trg_notify_booking_change
  after update of status, driver_id on public.bookings
  for each row execute function public.notify_booking_change();
drop function if exists public.notify_booking_completed();

-- ── Live updates for the dispatch board, the map and the driver app ─────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings') then
      alter publication supabase_realtime add table public.bookings;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'drivers') then
      alter publication supabase_realtime add table public.drivers;
    end if;
  end if;
end $$;

commit;


-- ══════════════════════════════ 2026-10-15_reminders.sql ══════════════════════════════

-- One-hour pickup reminders (2026-10-15)
--
-- Every 5 minutes Supabase's scheduler (pg_cron, available on every plan) calls
-- the app's /api/cron/reminders. The app finds pre-booked journeys starting
-- within the next hour and, once per booking:
--   • pushes "Pickup in 1 hour" to the assigned driver's phone (driver app);
--   • emails the staff alert addresses, flagging jobs with no driver yet.
-- (The dispatch board also shows these live, with a sound, while it is open.)
--
--   bookings.reminder_sent_at  set when the reminder went out — sent once only
--
-- Needs 2026-10-13_ride_thank_you.sql (pg_net + the webhook URL) run first.
-- Safe to re-run.
begin;

create extension if not exists pg_cron;

alter table public.bookings add column if not exists reminder_sent_at timestamptz;
comment on column public.bookings.reminder_sent_at is
  'When the one-hour pickup reminder (driver push + staff email) was sent. Null = not yet.';

-- Where the reminder endpoint lives: same site as the booking-status webhook.
update public.app_settings
   set value = jsonb_set(
         value,
         '{reminders_url}',
         to_jsonb(regexp_replace(value->>'booking_status_url', '/api/webhooks/booking-status$', '/api/cron/reminders'))
       ),
       updated_at = now()
 where key = 'webhooks' and coalesce(value->>'booking_status_url', '') <> '';

create or replace function public.run_booking_reminders()
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_url text;
begin
  select value->>'reminders_url' into v_url from app_settings where key = 'webhooks';
  if coalesce(v_url, '') <> '' then
    perform net.http_post(
      url     := v_url,
      body    := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  end if;
end;
$$;

-- (Re)schedule every 5 minutes.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'booking-reminders';
exception when others then null;
end $$;
select cron.schedule('booking-reminders', '*/5 * * * *', 'select public.run_booking_reminders()');

commit;


-- ══════════════════════════════ 2026-10-15_scheduled_jobs.sql ══════════════════════════════

-- Scheduled jobs stay scheduled until an hour before pickup (2026-10-15)
--
-- A driver can accept tomorrow's job today without showing as BUSY all day.
-- A driver is busy when they have a job that is "live":
--   • they are at the pick-up or driving it (driver_arrived / in_progress), or
--   • they have accepted it and it is due within the hour (or has no set time).
-- The every-5-minutes scheduler (booking-reminders, see 2026-10-15_reminders.sql)
-- also re-checks drivers whose accepted job has just come into that hour, so
-- they turn busy on time — the same moment the job moves to the Live tab and
-- the reminder goes out.
--
-- Run after 2026-10-15_reminders.sql. Safe to re-run.
begin;

create or replace function public.sync_driver_availability(p_driver uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_active boolean;
begin
  if p_driver is null then return; end if;
  select exists (
    select 1 from bookings
     where driver_id = p_driver
       and (
         status in ('driver_arrived', 'in_progress')
         or (status = 'accepted' and (scheduled_at is null or scheduled_at <= now() + interval '60 minutes'))
       )
  ) into v_active;
  if v_active then
    update drivers set availability = 'on_trip'
     where id = p_driver and profile_id is not null and availability <> 'on_trip';
  else
    update drivers set availability = 'online'
     where id = p_driver and profile_id is not null and availability = 'on_trip';
  end if;
end;
$$;

-- Every 5 minutes: reminders (via the app) + turn drivers busy as their
-- accepted pre-booked job comes within the hour.
create or replace function public.run_booking_reminders()
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_url text;
  r record;
begin
  for r in
    select distinct driver_id from bookings
     where status = 'accepted' and driver_id is not null
       and scheduled_at is not null
       and scheduled_at <= now() + interval '65 minutes'
       and scheduled_at > now() - interval '6 hours'
  loop
    perform sync_driver_availability(r.driver_id);
  end loop;

  select value->>'reminders_url' into v_url from app_settings where key = 'webhooks';
  if coalesce(v_url, '') <> '' then
    perform net.http_post(
      url     := v_url,
      body    := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  end if;
end;
$$;

-- Drivers who are "busy" today only because they accepted a future job: free them now.
select public.sync_driver_availability(id) from public.drivers where availability = 'on_trip';

commit;


-- ══════════════════════════════ 2026-10-15_notifications.sql ══════════════════════════════

-- Staff notifications — the 🔔 in the admin and dispatch screens (2026-10-15)
--
-- Every change to a job is written here by the database itself, so nothing is
-- missed whoever made it (dispatch board, driver app, website, Stripe):
--   new booking · assigned · accepted · declined by driver · arrived ·
--   customer picked up · completed · cancelled · card payment received
-- plus the one-hour reminders (written by /api/cron/reminders).
--
-- Each staff member has their own "seen up to" time (profiles.notifications_seen_at):
-- anything newer is unread. Older than 30 days is deleted by the 5-minute job.
--
-- Run after 2026-10-15_scheduled_jobs.sql. Safe to re-run.
begin;

create table if not exists public.staff_notifications (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  kind        text not null,
  -- info | good | warn | urgent — colours the row
  severity    text not null default 'info',
  title       text not null,
  body        text,
  booking_id  uuid references public.bookings(id) on delete cascade,
  driver_id   uuid references public.drivers(id) on delete set null
);
create index if not exists staff_notifications_created_idx on public.staff_notifications (created_at desc);

alter table public.staff_notifications enable row level security;
drop policy if exists "staff_notifications_staff_read" on public.staff_notifications;
create policy "staff_notifications_staff_read" on public.staff_notifications
  as permissive for select to authenticated using (is_staff());

alter table public.profiles add column if not exists notifications_seen_at timestamptz not null default now();

-- ── Write a notification for every meaningful change to a booking ──────────
create or replace function public.notify_staff_on_booking()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_driver     text;
  v_old_driver text;
  v_when       text;
  v_route      text := coalesce(new.pickup_address, '') || ' → ' || coalesce(new.dropoff_address, '');
  v_ref        text := coalesce(new.booking_number, 'Booking');
  v_fare       numeric := coalesce(new.final_fare, new.estimated_fare, 0);

begin
  select full_name into v_driver from drivers where id = new.driver_id;
  v_driver := coalesce(v_driver, new.external_driver_name, 'Driver');
  v_when := case when new.scheduled_at is null then 'ASAP'
                 else to_char(new.scheduled_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI') end;

  if tg_op = 'INSERT' then
    insert into staff_notifications(kind, severity, title, body, booking_id)
    values ('new', 'info', 'New booking ' || v_ref || ' · ' || v_when,
            coalesce(new.customer_name, 'Customer') || ' — ' || v_route, new.id);
    return null;
  end if;

  -- Declined by the driver: back to the queue with no driver.
  if old.driver_id is not null and new.driver_id is null and new.status = 'pending'
     and old.status in ('assigned', 'accepted') then
    select full_name into v_old_driver from drivers where id = old.driver_id;
    insert into staff_notifications(kind, severity, title, body, booking_id, driver_id)
    values ('declined', 'urgent', coalesce(v_old_driver, 'Driver') || ' declined ' || v_ref,
            'Needs a new driver · ' || v_when || ' · ' || v_route, new.id, old.driver_id);
    return null;
  end if;

  -- (Re)assigned to a driver.
  if new.driver_id is not null and new.driver_id is distinct from old.driver_id then
    insert into staff_notifications(kind, severity, title, body, booking_id, driver_id)
    values ('assigned', 'info', v_ref || ' assigned to ' || v_driver, v_when || ' · ' || v_route, new.id, new.driver_id);
  elsif new.external_driver_name is not null and new.external_driver_name is distinct from old.external_driver_name then
    insert into staff_notifications(kind, severity, title, body, booking_id)
    values ('assigned', 'info', v_ref || ' given to outside driver ' || new.external_driver_name, v_when || ' · ' || v_route, new.id);
  end if;

  if new.status is distinct from old.status then
    if new.status = 'accepted' then
      insert into staff_notifications(kind, severity, title, body, booking_id, driver_id)
      values ('accepted', 'good', v_driver || ' accepted ' || v_ref, v_when || ' · ' || v_route, new.id, new.driver_id);
    elsif new.status = 'driver_arrived' then
      insert into staff_notifications(kind, severity, title, body, booking_id, driver_id)
      values ('arrived', 'info', v_driver || ' arrived for ' || v_ref, coalesce(new.pickup_address, ''), new.id, new.driver_id);
    elsif new.status = 'in_progress' then
      insert into staff_notifications(kind, severity, title, body, booking_id, driver_id)
      values ('picked_up', 'info', v_driver || ' picked up ' || coalesce(new.customer_name, 'the customer'),
              v_ref || ' · to ' || coalesce(new.dropoff_address, ''), new.id, new.driver_id);
    elsif new.status = 'completed' then
      insert into staff_notifications(kind, severity, title, body, booking_id, driver_id)
      values ('completed', 'good', v_ref || ' completed' || case when new.driver_id is not null or new.external_driver_name is not null then ' by ' || v_driver else '' end,
              '£' || to_char(v_fare, 'FM999990.00') || ' · ' || new.payment_method::text, new.id, new.driver_id);
    elsif new.status = 'cancelled' then
      insert into staff_notifications(kind, severity, title, body, booking_id, driver_id)
      values ('cancelled', 'warn', v_ref || ' cancelled', v_when || ' · ' || v_route, new.id, new.driver_id);
    end if;
  end if;

  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' and new.payment_method = 'card' then
    insert into staff_notifications(kind, severity, title, body, booking_id)
    values ('paid', 'good', 'Card payment received · ' || v_ref, '£' || to_char(v_fare, 'FM999990.00'), new.id);
  end if;

  return null;
exception when others then
  -- A notification must never stop a booking being saved.
  return null;
end;
$$;

drop trigger if exists trg_notify_staff_on_booking on public.bookings;
create trigger trg_notify_staff_on_booking
  after insert or update of status, driver_id, external_driver_name, payment_status on public.bookings
  for each row execute function public.notify_staff_on_booking();

-- Keep 30 days: fold the clean-up into the every-5-minutes job.
create or replace function public.run_booking_reminders()
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_url text;
  r record;
begin
  for r in
    select distinct driver_id from bookings
     where status = 'accepted' and driver_id is not null
       and scheduled_at is not null
       and scheduled_at <= now() + interval '65 minutes'
       and scheduled_at > now() - interval '6 hours'
  loop
    perform sync_driver_availability(r.driver_id);
  end loop;

  delete from staff_notifications where created_at < now() - interval '30 days';

  select value->>'reminders_url' into v_url from app_settings where key = 'webhooks';
  if coalesce(v_url, '') <> '' then
    perform net.http_post(
      url     := v_url,
      body    := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  end if;
end;
$$;

-- Live updates for the bell.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff_notifications') then
    alter publication supabase_realtime add table public.staff_notifications;
  end if;
end $$;

commit;


-- ══════════════════════════════ 2026-10-19_fixed_prices.sql ══════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixed prices between drawn areas + whole-pound fares.     (2026-10-19)
--
-- Admin → Pricing → "Fixed prices between areas":
--   • pricing_zones  — areas drawn on the map (Sheerness, Heathrow, Luton …)
--   • fixed_routes   — From area → To area, a price per vehicle type, and
--                      "both ways" so the reverse trip / return costs the same.
--
-- How a fare is worked out now (estimate_fare):
--   1. Pickup inside a route's From area and drop-off inside its To area (or the
--      other way round when "both ways" is ticked) AND that route has a price for
--      the chosen vehicle → that fixed price.
--        • Stops that make the trip longer than the direct pickup → drop-off
--          route add the extra miles at the vehicle's per-mile rate.
--        • Extra charges (night, airport …) are NOT added unless Admin ticks
--          "Also add extra charges on top of fixed prices".
--   2. Otherwise → the normal per-mile pricing (base fare + distance bands +
--      extra charges), exactly as before.
--   3. Every total is rounded to the nearest pound (4.30 → 4, 4.50 → 5, 4.60 → 5).
--
-- Safe to run more than once. Run AFTER all earlier db/ files.
-- The app keeps working while this is not yet run (it falls back to the old call).
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists public.pricing_zones (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text not null default '#1d4ed8',
  -- [[lat, lng], [lat, lng], …] — at least 3 corners, drawn in Admin → Pricing.
  polygon     jsonb not null default '[]'::jsonb,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.fixed_routes (
  id            uuid primary key default gen_random_uuid(),
  from_zone_id  uuid not null references public.pricing_zones(id) on delete cascade,
  to_zone_id    uuid not null references public.pricing_zones(id) on delete cascade,
  both_ways     boolean not null default true,
  -- { "<vehicle_categories.id>": 100, … } — a vehicle without a price here uses
  -- the normal per-mile pricing on this route.
  prices        jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

alter table public.pricing_zones enable row level security;
alter table public.fixed_routes  enable row level security;

drop policy if exists "zones_staff_all" on public.pricing_zones;
create policy "zones_staff_all" on public.pricing_zones for all to authenticated
  using (is_staff()) with check (is_staff());
drop policy if exists "fixed_routes_staff_all" on public.fixed_routes;
create policy "fixed_routes_staff_all" on public.fixed_routes for all to authenticated
  using (is_staff()) with check (is_staff());

-- "Also add extra charges on top of fixed prices" — off unless the admin ticks it.
insert into public.app_settings (key, value)
values ('fixed_prices', '{"add_extras": false}'::jsonb)
on conflict (key) do nothing;

-- ── Is a point inside a drawn area? (ray casting) ──────────────────────────
create or replace function public.point_in_zone(p_lat double precision, p_lng double precision, p_poly jsonb)
returns boolean language plpgsql immutable set search_path to 'public' as $$
declare
  n int; i int; j int;
  yi double precision; xi double precision;
  yj double precision; xj double precision;
  inside boolean := false;
begin
  if p_lat is null or p_lng is null or p_poly is null or jsonb_typeof(p_poly) <> 'array' then
    return false;
  end if;
  n := jsonb_array_length(p_poly);
  if n < 3 then return false; end if;
  j := n - 1;
  for i in 0 .. n - 1 loop
    yi := (p_poly->i->>0)::double precision; xi := (p_poly->i->>1)::double precision;
    yj := (p_poly->j->>0)::double precision; xj := (p_poly->j->>1)::double precision;
    -- Nested ifs: SQL doesn't promise to short-circuit, and yi = yj would divide by zero.
    if (yi > p_lat) <> (yj > p_lat) then
      if p_lng < (xj - xi) * (p_lat - yi) / (yj - yi) + xi then
        inside := not inside;
      end if;
    end if;
    j := i;
  end loop;
  return inside;
end $$;

-- ── The fixed route (if any) for this vehicle and these two points ─────────
create or replace function public.find_fixed_route(
  p_category_id uuid,
  p_pickup_lat double precision, p_pickup_lng double precision,
  p_dropoff_lat double precision, p_dropoff_lng double precision
) returns jsonb language plpgsql stable set search_path to 'public' as $$
declare
  r record;
begin
  if p_pickup_lat is null or p_pickup_lng is null or p_dropoff_lat is null or p_dropoff_lng is null then
    return null;
  end if;

  for r in
    select fr.id, fr.prices, fr.both_ways, fz.name as from_name, fz.polygon as from_poly,
           tz.name as to_name, tz.polygon as to_poly
      from fixed_routes fr
      join pricing_zones fz on fz.id = fr.from_zone_id and fz.is_active
      join pricing_zones tz on tz.id = fr.to_zone_id and tz.is_active
     where fr.is_active
       and jsonb_typeof(fr.prices -> p_category_id::text) = 'number'
       and (fr.prices ->> p_category_id::text)::numeric > 0
     order by fr.sort_order asc, fr.created_at asc
  loop
    if point_in_zone(p_pickup_lat, p_pickup_lng, r.from_poly) and point_in_zone(p_dropoff_lat, p_dropoff_lng, r.to_poly) then
      return jsonb_build_object('route_id', r.id, 'name', r.from_name || ' → ' || r.to_name,
                                'price', (r.prices ->> p_category_id::text)::numeric);
    end if;
    if r.both_ways and point_in_zone(p_pickup_lat, p_pickup_lng, r.to_poly) and point_in_zone(p_dropoff_lat, p_dropoff_lng, r.from_poly) then
      return jsonb_build_object('route_id', r.id, 'name', r.to_name || ' → ' || r.from_name,
                                'price', (r.prices ->> p_category_id::text)::numeric);
    end if;
  end loop;
  return null;
end $$;

-- ── estimate_fare: fixed route first, else per mile; whole pounds ──────────
-- Old signature removed so calls can't be ambiguous; the new one takes the same
-- arguments plus optional coordinates and the direct (no-stops) distance.
drop function if exists public.estimate_fare(uuid, numeric, numeric, text, text, timestamptz);

create or replace function public.estimate_fare(
  p_category_id uuid,
  p_distance_km numeric,
  p_duration_min numeric,
  p_pickup text default '',
  p_dropoff text default '',
  p_at timestamptz default now(),
  p_pickup_lat double precision default null,
  p_pickup_lng double precision default null,
  p_dropoff_lat double precision default null,
  p_dropoff_lng double precision default null,
  -- Distance of the same trip WITHOUT its stops. Only sent when there are stops.
  p_direct_km numeric default null
) returns jsonb language plpgsql stable set search_path to 'public' as $function$
declare
  c            vehicle_categories%rowtype;
  v_base       numeric := 0;
  v_dist       numeric := 0;
  v_subtotal   numeric := 0;
  v_extras     jsonb   := '[]'::jsonb;
  v_extra_sum  numeric := 0;
  r            record;
  v_add        numeric;
  v_route      text;
  v_now_t      time;
  v_hit        boolean;
  v_tz         text;
  v_seg        numeric;
  b            record;
  v_add_up     boolean;
  v_rate       numeric;
  v_fixed      jsonb;
  v_do_extras  boolean := true;
  v_detour_mi  numeric := 0;
  v_detour     numeric := 0;
  v_mile_rate  numeric := 0;
  v_unrounded  numeric;
begin
  select * into c from vehicle_categories where id = p_category_id;
  if not found then
    return jsonb_build_object('error','invalid_category');
  end if;

  v_base := coalesce(c.base_fare,0);

  -- Admin → Pricing "Add up distance bands" (app_settings.distance_bands.add_up,
  -- on when missing).
  select coalesce((value->>'add_up')::boolean, true) into v_add_up
    from app_settings where key = 'distance_bands';
  if v_add_up is null then v_add_up := true; end if;

  if v_add_up then
    -- Each band charges just the portion of the trip inside it, income-tax-bracket
    -- style. A category with no bands charges nothing for distance.
    for b in
      select from_km, to_km, price_per_km
      from pricing_bands where category_id = p_category_id
      order by from_km asc
    loop
      v_seg := least(coalesce(p_distance_km,0), b.to_km) - b.from_km;
      if v_seg > 0 then
        v_dist := v_dist + v_seg * coalesce(b.price_per_km,0);
      end if;
    end loop;
  else
    -- The whole trip at the rate of the band it ends in: 15 mi in "10-25 @ 4.5"
    -- is 15 × 4.5. Past the last band, the last band's rate carries on.
    select price_per_km into v_rate
      from pricing_bands
      where category_id = p_category_id and from_km < coalesce(p_distance_km,0)
      order by from_km desc
      limit 1;
    v_dist := coalesce(p_distance_km,0) * coalesce(v_rate,0);
  end if;

  -- Fixed route between two drawn areas?
  v_fixed := find_fixed_route(p_category_id, p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);

  if v_fixed is not null then
    -- Stops off the direct route: the extra miles at this vehicle's per-mile rate
    -- (the rate of the distance band the whole trip falls in).
    if p_direct_km is not null and coalesce(p_distance_km,0) > p_direct_km then
      v_detour_mi := coalesce(p_distance_km,0) - p_direct_km;
      select price_per_km into v_mile_rate
        from pricing_bands
        where category_id = p_category_id and from_km < coalesce(p_distance_km,0)
        order by from_km desc
        limit 1;
      v_detour := round(v_detour_mi * coalesce(v_mile_rate,0), 2);
    end if;
    v_subtotal := (v_fixed->>'price')::numeric + v_detour;
    select coalesce((value->>'add_extras')::boolean, false) into v_do_extras
      from app_settings where key = 'fixed_prices';
    v_do_extras := coalesce(v_do_extras, false);
  else
    v_subtotal := v_base + v_dist;
  end if;

  v_route := lower(coalesce(p_pickup,'') || ' ' || coalesce(p_dropoff,''));

  select coalesce(value->>'timezone', 'Europe/London') into v_tz from app_settings where key = 'company';
  if v_tz is null then v_tz := 'Europe/London'; end if;
  v_now_t := (p_at at time zone v_tz)::time;

  -- Extra charges (airport keyword, night window, always-on). A percentage
  -- charge is a % of the fare before extras.
  if v_do_extras then
    for r in
      select * from pricing_rules
      where is_active and (category_id is null or category_id = p_category_id)
      order by sort_order asc
    loop
      v_hit := false;
      if r.applies_all then
        v_hit := true;
      elsif r.keyword is not null and r.keyword <> '' and v_route like '%' || lower(r.keyword) || '%' then
        v_hit := true;
      elsif r.start_time is not null and r.end_time is not null then
        if r.start_time <= r.end_time then
          v_hit := v_now_t >= r.start_time and v_now_t < r.end_time;
        else
          v_hit := v_now_t >= r.start_time or v_now_t < r.end_time;
        end if;
      end if;

      if v_hit then
        if r.charge_type = 'percentage' then
          v_add := round(v_subtotal * r.amount / 100.0, 2);
        else
          v_add := r.amount;
        end if;
        v_extra_sum := v_extra_sum + v_add;
        v_extras := v_extras || jsonb_build_object('name', r.name, 'amount', v_add, 'type', r.charge_type);
      end if;
    end loop;
  end if;

  v_unrounded := v_subtotal + v_extra_sum;

  if v_fixed is not null then
    return jsonb_build_object(
      'category',      c.name,
      'fixed_route',   v_fixed->>'name',
      'fixed_price',   round((v_fixed->>'price')::numeric, 2),
      'detour_miles',  round(v_detour_mi, 2),
      'detour_cost',   v_detour,
      'base_fare',     0,
      'distance_cost', v_detour,
      'extras',        v_extras,
      'extras_total',  round(v_extra_sum,2),
      'unrounded',     round(v_unrounded, 2),
      'total',         round(v_unrounded)            -- whole pounds
    );
  end if;

  return jsonb_build_object(
    'category',      c.name,
    'base_fare',     round(v_base,2),
    'distance_cost', round(v_dist,2),
    'extras',        v_extras,
    'extras_total',  round(v_extra_sum,2),
    'unrounded',     round(v_unrounded, 2),
    'total',         round(v_unrounded)              -- whole pounds
  );
end; $function$;

-- ── quote_fares: same, with coordinates ────────────────────────────────────
drop function if exists public.quote_fares(text, numeric, numeric, text, text, timestamptz, text);

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
  -- Whole pounds, like every fare.
  v_child_price numeric := round(coalesce((select (value->>'amount')::numeric from app_settings where key = 'child_seat_price'), 0));
  v_kw text := coalesce(nullif(trim(coalesce(p_route_text,'')),''), p_pickup || ' ' || p_dropoff);
begin
  select * into w from websites where api_key = p_api_key and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_website');
  end if;

  for c in select * from vehicle_categories where is_active order by sort_order asc loop
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

-- ── create_booking: prices with coordinates; whole pounds ──────────────────
drop function if exists public.create_booking(text, text, text, text, text, uuid, double precision, double precision, double precision, double precision, numeric, numeric, payment_method, text, timestamptz, jsonb, uuid, boolean, text, text, text, integer, integer, integer);

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
  v_email text := nullif(trim(coalesce(p_email,'')), '');
  v_child_seat boolean := nullif(trim(coalesce(p_child_seat,'')), '') is not null;
  v_kw text := coalesce(nullif(trim(coalesce(p_route_text,'')),''), p_pickup_address || ' ' || p_dropoff_address);
begin
  select * into w from websites where api_key = p_api_key and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_or_inactive_website');
  end if;

  if p_customer_name is null or length(trim(p_customer_name)) = 0
     or p_whatsapp is null or length(trim(p_whatsapp)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'missing_customer_details');
  end if;

  -- Scheduled-time guard (skipped for immediate "now" bookings).
  if p_scheduled_at is not null then
    v_min_adv := coalesce((select (value->>'min_advance_minutes')::int from app_settings where key = 'booking'), 30);
    if p_scheduled_at < now() + make_interval(mins => greatest(v_min_adv - 2, 0)) then
      return jsonb_build_object('ok', false, 'error', 'scheduled_too_soon');
    end if;
  end if;

  insert into customers(full_name, whatsapp, email)
  values (trim(p_customer_name), trim(p_whatsapp), v_email)
  on conflict (whatsapp) do update set
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
    v_child_price := round(coalesce((select (value->>'amount')::numeric from app_settings where key = 'child_seat_price'), 0));
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
    website_id, customer_id, customer_name, customer_whatsapp, customer_email,
    pickup_address, pickup_lat, pickup_lng,
    dropoff_address, dropoff_lat, dropoff_lng,
    vehicle_category_id, distance_km, duration_min,
    estimated_fare, fare_breakdown, payment_method, notes, child_seat,
    passengers, suitcases, hand_luggage, scheduled_at, status,
    via_points, trip_group_id, is_return
  ) values (
    w.id, v_customer.id, trim(p_customer_name), trim(p_whatsapp), v_email,
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
    'website', w.name
  );
end; $function$;

grant execute on function public.point_in_zone(double precision, double precision, jsonb) to anon, authenticated, service_role;
grant execute on function public.find_fixed_route(uuid, double precision, double precision, double precision, double precision) to anon, authenticated, service_role;
grant execute on function public.estimate_fare(uuid, numeric, numeric, text, text, timestamptz, double precision, double precision, double precision, double precision, numeric) to anon, authenticated, service_role;
grant execute on function public.quote_fares(text, numeric, numeric, text, text, timestamptz, text, double precision, double precision, double precision, double precision, numeric) to anon, authenticated, service_role;
grant execute on function public.create_booking(text, text, text, text, text, uuid, double precision, double precision, double precision, double precision, numeric, numeric, payment_method, text, timestamptz, jsonb, uuid, boolean, text, text, text, integer, integer, integer, numeric) to anon, authenticated, service_role;

-- Safety net: exactly one version of each pricing function must remain, or the
-- app's calls would be ambiguous. If not, this aborts and NOTHING is changed.
do $$
declare f text; n int;
begin
  foreach f in array array['estimate_fare', 'quote_fares', 'create_booking'] loop
    select count(*) into n from pg_proc where proname = f and pronamespace = 'public'::regnamespace;
    if n <> 1 then
      raise exception 'Expected one public.% but found % — nothing was changed. Send this message to the developer.', f, n;
    end if;
  end loop;
end $$;

-- PostgREST picks up the new function signatures straight away.
notify pgrst, 'reload schema';

commit;


-- ══════════════════════════════ 2026-10-22_route_night_rate.sql ══════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- Night rate on chosen fixed routes.                         (2026-10-22)
--
-- Adds a tick-box to each fixed route: "Night rate / time-based charges apply".
--   • Ticked   → extra charges that have a time window (e.g. Night rate +20%,
--                23:00–06:00) are added on top of that route's fixed price.
--                Keyword charges (airport) and "every journey" charges are not.
--   • Unticked → the fixed price stays all-in (as before).
-- Every existing route starts UNTICKED, so no price changes until you tick one.
-- The global "Also add extra charges on top of fixed prices" switch still wins:
-- when it is on, every extra charge applies to every fixed route.
--
-- Run AFTER 2026-10-19_fixed_prices.sql. Safe to run more than once. Function
-- signatures are unchanged, so the app keeps working before and after.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

alter table public.fixed_routes add column if not exists time_charges boolean not null default false;

create or replace function public.find_fixed_route(
  p_category_id uuid,
  p_pickup_lat double precision, p_pickup_lng double precision,
  p_dropoff_lat double precision, p_dropoff_lng double precision
) returns jsonb language plpgsql stable set search_path to 'public' as $$
declare
  r record;
begin
  if p_pickup_lat is null or p_pickup_lng is null or p_dropoff_lat is null or p_dropoff_lng is null then
    return null;
  end if;

  for r in
    select fr.id, fr.prices, fr.both_ways, fr.time_charges, fz.name as from_name, fz.polygon as from_poly,
           tz.name as to_name, tz.polygon as to_poly
      from fixed_routes fr
      join pricing_zones fz on fz.id = fr.from_zone_id and fz.is_active
      join pricing_zones tz on tz.id = fr.to_zone_id and tz.is_active
     where fr.is_active
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

create or replace function public.estimate_fare(
  p_category_id uuid,
  p_distance_km numeric,
  p_duration_min numeric,
  p_pickup text default '',
  p_dropoff text default '',
  p_at timestamptz default now(),
  p_pickup_lat double precision default null,
  p_pickup_lng double precision default null,
  p_dropoff_lat double precision default null,
  p_dropoff_lng double precision default null,
  -- Distance of the same trip WITHOUT its stops. Only sent when there are stops.
  p_direct_km numeric default null
) returns jsonb language plpgsql stable set search_path to 'public' as $function$
declare
  c            vehicle_categories%rowtype;
  v_base       numeric := 0;
  v_dist       numeric := 0;
  v_subtotal   numeric := 0;
  v_extras     jsonb   := '[]'::jsonb;
  v_extra_sum  numeric := 0;
  r            record;
  v_add        numeric;
  v_route      text;
  v_now_t      time;
  v_hit        boolean;
  v_tz         text;
  v_seg        numeric;
  b            record;
  v_add_up     boolean;
  v_rate       numeric;
  v_fixed      jsonb;
  v_do_extras  boolean := true;
  v_time_only  boolean := false;
  v_detour_mi  numeric := 0;
  v_detour     numeric := 0;
  v_mile_rate  numeric := 0;
  v_unrounded  numeric;
begin
  select * into c from vehicle_categories where id = p_category_id;
  if not found then
    return jsonb_build_object('error','invalid_category');
  end if;

  v_base := coalesce(c.base_fare,0);

  -- Admin → Pricing "Add up distance bands" (app_settings.distance_bands.add_up,
  -- on when missing).
  select coalesce((value->>'add_up')::boolean, true) into v_add_up
    from app_settings where key = 'distance_bands';
  if v_add_up is null then v_add_up := true; end if;

  if v_add_up then
    -- Each band charges just the portion of the trip inside it, income-tax-bracket
    -- style. A category with no bands charges nothing for distance.
    for b in
      select from_km, to_km, price_per_km
      from pricing_bands where category_id = p_category_id
      order by from_km asc
    loop
      v_seg := least(coalesce(p_distance_km,0), b.to_km) - b.from_km;
      if v_seg > 0 then
        v_dist := v_dist + v_seg * coalesce(b.price_per_km,0);
      end if;
    end loop;
  else
    -- The whole trip at the rate of the band it ends in: 15 mi in "10-25 @ 4.5"
    -- is 15 × 4.5. Past the last band, the last band's rate carries on.
    select price_per_km into v_rate
      from pricing_bands
      where category_id = p_category_id and from_km < coalesce(p_distance_km,0)
      order by from_km desc
      limit 1;
    v_dist := coalesce(p_distance_km,0) * coalesce(v_rate,0);
  end if;

  -- Fixed route between two drawn areas?
  v_fixed := find_fixed_route(p_category_id, p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);

  if v_fixed is not null then
    -- Stops off the direct route: the extra miles at this vehicle's per-mile rate
    -- (the rate of the distance band the whole trip falls in).
    if p_direct_km is not null and coalesce(p_distance_km,0) > p_direct_km then
      v_detour_mi := coalesce(p_distance_km,0) - p_direct_km;
      select price_per_km into v_mile_rate
        from pricing_bands
        where category_id = p_category_id and from_km < coalesce(p_distance_km,0)
        order by from_km desc
        limit 1;
      v_detour := round(v_detour_mi * coalesce(v_mile_rate,0), 2);
    end if;
    v_subtotal := (v_fixed->>'price')::numeric + v_detour;
    select coalesce((value->>'add_extras')::boolean, false) into v_do_extras
      from app_settings where key = 'fixed_prices';
    v_do_extras := coalesce(v_do_extras, false);
    -- Route ticked "Night rate / time-based charges apply": only charges with a
    -- time window (e.g. 23:00–06:00) are added — never keyword/always charges.
    if not v_do_extras and coalesce((v_fixed->>'time_charges')::boolean, false) then
      v_do_extras := true;
      v_time_only := true;
    end if;
  else
    v_subtotal := v_base + v_dist;
  end if;

  v_route := lower(coalesce(p_pickup,'') || ' ' || coalesce(p_dropoff,''));

  select coalesce(value->>'timezone', 'Europe/London') into v_tz from app_settings where key = 'company';
  if v_tz is null then v_tz := 'Europe/London'; end if;
  v_now_t := (p_at at time zone v_tz)::time;

  -- Extra charges (airport keyword, night window, always-on). A percentage
  -- charge is a % of the fare before extras.
  if v_do_extras then
    for r in
      select * from pricing_rules
      where is_active and (category_id is null or category_id = p_category_id)
      order by sort_order asc
    loop
      v_hit := false;
      if v_time_only then
        if r.start_time is not null and r.end_time is not null then
          if r.start_time <= r.end_time then
            v_hit := v_now_t >= r.start_time and v_now_t < r.end_time;
          else
            v_hit := v_now_t >= r.start_time or v_now_t < r.end_time;
          end if;
        end if;
      elsif r.applies_all then
        v_hit := true;
      elsif r.keyword is not null and r.keyword <> '' and v_route like '%' || lower(r.keyword) || '%' then
        v_hit := true;
      elsif r.start_time is not null and r.end_time is not null then
        if r.start_time <= r.end_time then
          v_hit := v_now_t >= r.start_time and v_now_t < r.end_time;
        else
          v_hit := v_now_t >= r.start_time or v_now_t < r.end_time;
        end if;
      end if;

      if v_hit then
        if r.charge_type = 'percentage' then
          v_add := round(v_subtotal * r.amount / 100.0, 2);
        else
          v_add := r.amount;
        end if;
        v_extra_sum := v_extra_sum + v_add;
        v_extras := v_extras || jsonb_build_object('name', r.name, 'amount', v_add, 'type', r.charge_type);
      end if;
    end loop;
  end if;

  v_unrounded := v_subtotal + v_extra_sum;

  if v_fixed is not null then
    return jsonb_build_object(
      'category',      c.name,
      'fixed_route',   v_fixed->>'name',
      'fixed_price',   round((v_fixed->>'price')::numeric, 2),
      'time_charges',  v_time_only,
      'detour_miles',  round(v_detour_mi, 2),
      'detour_cost',   v_detour,
      'base_fare',     0,
      'distance_cost', v_detour,
      'extras',        v_extras,
      'extras_total',  round(v_extra_sum,2),
      'unrounded',     round(v_unrounded, 2),
      'total',         round(v_unrounded)            -- whole pounds
    );
  end if;

  return jsonb_build_object(
    'category',      c.name,
    'base_fare',     round(v_base,2),
    'distance_cost', round(v_dist,2),
    'extras',        v_extras,
    'extras_total',  round(v_extra_sum,2),
    'unrounded',     round(v_unrounded, 2),
    'total',         round(v_unrounded)              -- whole pounds
  );
end; $function$;


-- Still exactly one of each (nothing else replaced).
do $$
declare f text; n int;
begin
  foreach f in array array['estimate_fare', 'find_fixed_route'] loop
    select count(*) into n from pg_proc where proname = f and pronamespace = 'public'::regnamespace;
    if n <> 1 then
      raise exception 'Expected one public.% but found % — nothing was changed. Send this message to the developer.', f, n;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;


-- ══════════════════════════════ 2026-10-23_charge_exclusions.sql ══════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- Extra charges can skip some journeys.                       (2026-10-23)
--
-- Each extra charge gets "Don't apply when the address contains: …"
-- (pricing_rules.exclude_keywords, comma-separated, e.g. "airport, heathrow").
-- If any of those words appears in the pickup / stop / drop-off addresses, the
-- charge is not added — on per-mile journeys and on fixed routes alike.
--
-- Also sets it for the existing TIME-WINDOW charges (the night rate) that don't
-- have one yet: "airport, heathrow, gatwick, stansted" — so the night rate is
-- no longer added to airport journeys. Change it any time in Admin → Pricing.
--
-- Run AFTER 2026-10-22_route_night_rate.sql. Safe to run more than once.
-- Function signatures are unchanged, so the app keeps working before and after.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

alter table public.pricing_rules add column if not exists exclude_keywords text;

update public.pricing_rules
   set exclude_keywords = 'airport, heathrow, gatwick, stansted'
 where start_time is not null and end_time is not null
   and coalesce(trim(exclude_keywords), '') = '';

create or replace function public.estimate_fare(
  p_category_id uuid,
  p_distance_km numeric,
  p_duration_min numeric,
  p_pickup text default '',
  p_dropoff text default '',
  p_at timestamptz default now(),
  p_pickup_lat double precision default null,
  p_pickup_lng double precision default null,
  p_dropoff_lat double precision default null,
  p_dropoff_lng double precision default null,
  -- Distance of the same trip WITHOUT its stops. Only sent when there are stops.
  p_direct_km numeric default null
) returns jsonb language plpgsql stable set search_path to 'public' as $function$
declare
  c            vehicle_categories%rowtype;
  v_base       numeric := 0;
  v_dist       numeric := 0;
  v_subtotal   numeric := 0;
  v_extras     jsonb   := '[]'::jsonb;
  v_extra_sum  numeric := 0;
  r            record;
  v_add        numeric;
  v_route      text;
  v_now_t      time;
  v_hit        boolean;
  v_tz         text;
  v_seg        numeric;
  b            record;
  v_add_up     boolean;
  v_rate       numeric;
  v_fixed      jsonb;
  v_do_extras  boolean := true;
  v_time_only  boolean := false;
  v_detour_mi  numeric := 0;
  v_detour     numeric := 0;
  v_mile_rate  numeric := 0;
  v_unrounded  numeric;
begin
  select * into c from vehicle_categories where id = p_category_id;
  if not found then
    return jsonb_build_object('error','invalid_category');
  end if;

  v_base := coalesce(c.base_fare,0);

  -- Admin → Pricing "Add up distance bands" (app_settings.distance_bands.add_up,
  -- on when missing).
  select coalesce((value->>'add_up')::boolean, true) into v_add_up
    from app_settings where key = 'distance_bands';
  if v_add_up is null then v_add_up := true; end if;

  if v_add_up then
    -- Each band charges just the portion of the trip inside it, income-tax-bracket
    -- style. A category with no bands charges nothing for distance.
    for b in
      select from_km, to_km, price_per_km
      from pricing_bands where category_id = p_category_id
      order by from_km asc
    loop
      v_seg := least(coalesce(p_distance_km,0), b.to_km) - b.from_km;
      if v_seg > 0 then
        v_dist := v_dist + v_seg * coalesce(b.price_per_km,0);
      end if;
    end loop;
  else
    -- The whole trip at the rate of the band it ends in: 15 mi in "10-25 @ 4.5"
    -- is 15 × 4.5. Past the last band, the last band's rate carries on.
    select price_per_km into v_rate
      from pricing_bands
      where category_id = p_category_id and from_km < coalesce(p_distance_km,0)
      order by from_km desc
      limit 1;
    v_dist := coalesce(p_distance_km,0) * coalesce(v_rate,0);
  end if;

  -- Fixed route between two drawn areas?
  v_fixed := find_fixed_route(p_category_id, p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);

  if v_fixed is not null then
    -- Stops off the direct route: the extra miles at this vehicle's per-mile rate
    -- (the rate of the distance band the whole trip falls in).
    if p_direct_km is not null and coalesce(p_distance_km,0) > p_direct_km then
      v_detour_mi := coalesce(p_distance_km,0) - p_direct_km;
      select price_per_km into v_mile_rate
        from pricing_bands
        where category_id = p_category_id and from_km < coalesce(p_distance_km,0)
        order by from_km desc
        limit 1;
      v_detour := round(v_detour_mi * coalesce(v_mile_rate,0), 2);
    end if;
    v_subtotal := (v_fixed->>'price')::numeric + v_detour;
    select coalesce((value->>'add_extras')::boolean, false) into v_do_extras
      from app_settings where key = 'fixed_prices';
    v_do_extras := coalesce(v_do_extras, false);
    -- Route ticked "Night rate / time-based charges apply": only charges with a
    -- time window (e.g. 23:00–06:00) are added — never keyword/always charges.
    if not v_do_extras and coalesce((v_fixed->>'time_charges')::boolean, false) then
      v_do_extras := true;
      v_time_only := true;
    end if;
  else
    v_subtotal := v_base + v_dist;
  end if;

  v_route := lower(coalesce(p_pickup,'') || ' ' || coalesce(p_dropoff,''));

  select coalesce(value->>'timezone', 'Europe/London') into v_tz from app_settings where key = 'company';
  if v_tz is null then v_tz := 'Europe/London'; end if;
  v_now_t := (p_at at time zone v_tz)::time;

  -- Extra charges (airport keyword, night window, always-on). A percentage
  -- charge is a % of the fare before extras.
  if v_do_extras then
    for r in
      select * from pricing_rules
      where is_active and (category_id is null or category_id = p_category_id)
      order by sort_order asc
    loop
      -- "Don't apply when the address contains …" (e.g. night rate not on
      -- airport journeys). Comma-separated words, matched anywhere in the
      -- pickup / stops / drop-off text.
      if coalesce(trim(r.exclude_keywords), '') <> '' and exists (
           select 1 from unnest(string_to_array(lower(r.exclude_keywords), ',')) w
            where trim(w) <> '' and v_route like '%' || trim(w) || '%') then
        continue;
      end if;
      v_hit := false;
      if v_time_only then
        if r.start_time is not null and r.end_time is not null then
          if r.start_time <= r.end_time then
            v_hit := v_now_t >= r.start_time and v_now_t < r.end_time;
          else
            v_hit := v_now_t >= r.start_time or v_now_t < r.end_time;
          end if;
        end if;
      elsif r.applies_all then
        v_hit := true;
      elsif r.keyword is not null and r.keyword <> '' and v_route like '%' || lower(r.keyword) || '%' then
        v_hit := true;
      elsif r.start_time is not null and r.end_time is not null then
        if r.start_time <= r.end_time then
          v_hit := v_now_t >= r.start_time and v_now_t < r.end_time;
        else
          v_hit := v_now_t >= r.start_time or v_now_t < r.end_time;
        end if;
      end if;

      if v_hit then
        if r.charge_type = 'percentage' then
          v_add := round(v_subtotal * r.amount / 100.0, 2);
        else
          v_add := r.amount;
        end if;
        v_extra_sum := v_extra_sum + v_add;
        v_extras := v_extras || jsonb_build_object('name', r.name, 'amount', v_add, 'type', r.charge_type);
      end if;
    end loop;
  end if;

  v_unrounded := v_subtotal + v_extra_sum;

  if v_fixed is not null then
    return jsonb_build_object(
      'category',      c.name,
      'fixed_route',   v_fixed->>'name',
      'fixed_price',   round((v_fixed->>'price')::numeric, 2),
      'time_charges',  v_time_only,
      'detour_miles',  round(v_detour_mi, 2),
      'detour_cost',   v_detour,
      'base_fare',     0,
      'distance_cost', v_detour,
      'extras',        v_extras,
      'extras_total',  round(v_extra_sum,2),
      'unrounded',     round(v_unrounded, 2),
      'total',         round(v_unrounded)            -- whole pounds
    );
  end if;

  return jsonb_build_object(
    'category',      c.name,
    'base_fare',     round(v_base,2),
    'distance_cost', round(v_dist,2),
    'extras',        v_extras,
    'extras_total',  round(v_extra_sum,2),
    'unrounded',     round(v_unrounded, 2),
    'total',         round(v_unrounded)              -- whole pounds
  );
end; $function$;



do $$
declare n int;
begin
  select count(*) into n from pg_proc where proname = 'estimate_fare' and pronamespace = 'public'::regnamespace;
  if n <> 1 then
    raise exception 'Expected one public.estimate_fare but found % — nothing was changed. Send this message to the developer.', n;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;


-- ══════════════════════════════ 2026-10-24_platform.sql ══════════════════════════════

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
  if to_regclass('public.companies') is null then
    -- The base tables come from the earlier files (00_schema.sql …); this one
    -- only converts them. (Nested IFs: the queries below must not even be
    -- planned when the tables are missing.)
    if to_regclass('public.bookings') is null or to_regclass('public.profiles') is null then
      raise exception 'The base tables are missing — run the earlier setup parts first (1a, then 1b), then this one. Nothing was changed.';
    end if;
    if exists (select 1 from public.bookings) or exists (select 1 from public.profiles) then
      raise exception 'This database already has bookings or staff. The platform setup is for a new, empty database — nothing was changed.';
    end if;
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
      'reminders_url',      'https://booking.airport-transfer.uk/api/cron/reminders')),
  -- Paid help, priced in the master dashboard (pounds; 0 = free / by quote).
  ('services', jsonb_build_object(
      'setup_packages', jsonb_build_array(
        jsonb_build_object('code', 'quick', 'name', 'Quick setup', 'price', 99,
          'description', 'We connect your card payments, email and SMS, and add your logo and colours.'),
        jsonb_build_object('code', 'full', 'name', 'Full setup', 'price', 249,
          'description', 'Quick setup, plus your prices and fixed routes, the booking widget on your website and a training call.')),
      'restore_price', 49))
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

-- Stripe ids are unique per company: each company's webhook is signed with a
-- secret that company holds, so one company must not be able to "use up"
-- another's event or payment ids.
do $$
begin
  if exists (select 1 from pg_constraint
              where conname = 'stripe_events_pkey' and conrelid = 'public.stripe_events'::regclass
                and array_length(conkey, 1) = 1) then
    alter table public.stripe_events drop constraint stripe_events_pkey;
    alter table public.stripe_events add constraint stripe_events_pkey primary key (company_id, id);
  end if;
end $$;
drop index if exists public.payments_stripe_payment_intent_id_key;
create unique index if not exists payments_company_intent_key
  on public.payments (company_id, stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

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

-- …and only the car class's own company's extra charges (airport, night rate).
-- A separate step so a database that already ran the one above gets it too.
do $$
declare
  sig regprocedure := 'public.estimate_fare(uuid, numeric, numeric, text, text, timestamptz, double precision, double precision, double precision, double precision, numeric)'::regprocedure;
  d text := pg_get_functiondef(sig);
begin
  if d !~ 'from pricing_rules\s+where company_id = c\.company_id' then
    if d !~ 'from pricing_rules\s+where is_active' then
      raise exception 'estimate_fare changed shape (extra-charges lookup not found) — nothing was changed';
    end if;
    execute regexp_replace(d, 'from pricing_rules(\s+)where is_active', 'from pricing_rules\1where company_id = c.company_id and is_active', 'g');
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
         using (company_id = (select current_company_id()) and (select is_staff()))
         with check (company_id = (select current_company_id()) and (select is_staff()))', t);
  end loop;
end $$;

-- Read-only for staff.
create policy "company_staff_read" on public.activity_logs for select to authenticated
  using (company_id = (select current_company_id()) and (select is_staff()));
create policy "company_staff_read" on public.driver_locations for select to authenticated
  using (company_id = (select current_company_id()) and (select is_staff()));
create policy "company_staff_read" on public.staff_notifications for select to authenticated
  using (company_id = (select current_company_id()) and (select is_staff()));

-- Anyone in the company (drivers too) may read its car classes and settings.
create policy "company_member_read" on public.vehicle_categories for select to authenticated
  using (company_id = (select current_company_id()));
create policy "company_member_read" on public.app_settings for select to authenticated
  using (company_id = (select current_company_id()));

-- Drivers: their own record, jobs, car, ratings, cash and the job history.
create policy "driver_self_read" on public.drivers for select to authenticated
  using (profile_id = (select auth.uid()) and company_id = (select current_company_id()));
create policy "driver_jobs_read" on public.bookings for select to authenticated
  using (driver_id is not null and driver_id = (select current_driver_id()));
create policy "driver_vehicle_read" on public.vehicles for select to authenticated
  using (driver_id = (select current_driver_id()));
create policy "driver_ratings_read" on public.ratings for select to authenticated
  using (driver_id = (select current_driver_id()));
create policy "driver_cash_read" on public.cash_settlements for select to authenticated
  using (driver_id = (select current_driver_id()));
create policy "driver_payments_read" on public.payments for select to authenticated
  using (booking_id in (select id from bookings where driver_id = (select current_driver_id())));
create policy "driver_events_read" on public.ride_events for select to authenticated
  using (booking_id in (select id from bookings where driver_id = (select current_driver_id())));

-- Staff logins: admins manage their own company's; everyone can read their own.
create policy "company_admin_all" on public.profiles for all to authenticated
  using (company_id = (select current_company_id()) and (select is_admin()))
  with check (company_id = (select current_company_id()) and (select is_admin()));
create policy "company_staff_read" on public.profiles for select to authenticated
  using (company_id = (select current_company_id()) and (select is_staff()));
create policy "self_read" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "self_update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Their own company row (name, plan, status) — read only.
create policy "own_company_read" on public.companies for select to authenticated
  using (id = (select company_id from profiles where id = (select auth.uid())));
create policy "public_plans_read" on public.plans for select to anon, authenticated
  using (is_active and is_public);
create policy "company_staff_read" on public.setup_requests for select to authenticated
  using (company_id = (select current_company_id()) and (select is_staff()));
create policy "company_staff_read" on public.restore_requests for select to authenticated
  using (company_id = (select current_company_id()) and (select is_staff()));
create policy "company_staff_read" on public.company_backups for select to authenticated
  using (company_id = (select current_company_id()) and (select is_admin()));

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

-- ── 10. Backups and restore ──────────────────────────────────────────────────
-- The app exports each company every night to the private "company-backups"
-- bucket (JSON, one key per table). Logos go in the public "branding" bucket.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('branding', 'branding', true) on conflict (id) do nothing;
    insert into storage.buckets (id, name, public) values ('company-backups', 'company-backups', false) on conflict (id) do nothing;
  end if;
end $$;

-- Put ONE company's data back to a backup, in one transaction: either all of it
-- is restored or nothing changes. Other companies are never touched. Logins
-- (profiles) are kept as they are now; drivers keep their login only if it
-- still exists. Money already moved in Stripe and messages already sent can't
-- be undone by this — it only restores what is in the database.
--
-- Triggers are switched off while the rows go back in (no SMS, no
-- notifications, no plan limits, no renumbering) and switched on again before
-- the transaction ends, so no other session ever sees them off. Service role
-- only: called by the app after it has checked who is asking.
create or replace function public.restore_company(p_company uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  -- Children first for deleting; reversed for inserting.
  t_delete text[] := array[
    'staff_notifications', 'ride_events', 'ratings', 'payments', 'cash_settlements',
    'push_subscriptions', 'driver_locations', 'checkout_drafts', 'bookings', 'customers',
    'vehicles', 'drivers', 'fixed_routes', 'pricing_zones', 'pricing_bands', 'pricing_rules',
    'vehicle_categories', 'websites', 'app_settings', 'activity_logs'];
  t_insert text[] := array[
    'app_settings', 'websites', 'vehicle_categories', 'pricing_rules', 'pricing_bands',
    'pricing_zones', 'fixed_routes', 'drivers', 'vehicles', 'customers', 'bookings',
    'payments', 'ride_events', 'ratings', 'cash_settlements', 'staff_notifications', 'activity_logs'];
  t text;
  rows jsonb;
  n int;
  counts jsonb := '{}'::jsonb;
begin
  if p_company is null or not exists (select 1 from companies where id = p_company) then
    raise exception 'No such company';
  end if;
  if jsonb_typeof(p_data -> 'tables') <> 'object' then
    raise exception 'Not a backup file';
  end if;
  if (p_data ->> 'company_id') is distinct from p_company::text then
    raise exception 'This backup belongs to another company';
  end if;

  foreach t in array t_delete loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;

  foreach t in array t_delete loop
    execute format('delete from public.%I where company_id = $1', t) using p_company;
  end loop;

  foreach t in array t_insert loop
    rows := coalesce(p_data -> 'tables' -> t, '[]'::jsonb);
    if jsonb_typeof(rows) <> 'array' then continue; end if;
    -- Every row is forced into this company, whatever the file says.
    rows := coalesce((select jsonb_agg(r || jsonb_build_object('company_id', p_company)) from jsonb_array_elements(rows) r), '[]'::jsonb);
    if t = 'drivers' then
      rows := coalesce((select jsonb_agg(case when exists (select 1 from profiles p where p.id = (r ->> 'profile_id')::uuid and p.company_id = p_company)
                                              then r else r || '{"profile_id": null}'::jsonb end)
                          from jsonb_array_elements(rows) r), '[]'::jsonb);
    elsif t = 'bookings' then
      -- The office user who took a booking may have been deleted since.
      rows := coalesce((select jsonb_agg(case when (r ->> 'dispatcher_id') is null
                                                or exists (select 1 from profiles p where p.id = (r ->> 'dispatcher_id')::uuid and p.company_id = p_company)
                                              then r else r || '{"dispatcher_id": null}'::jsonb end)
                          from jsonb_array_elements(rows) r), '[]'::jsonb);
    end if;
    execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)', t, t) using rows;
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object(t, n);
  end loop;

  foreach t in array t_delete loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;

  return jsonb_build_object('ok', true, 'rows', counts);
end $$;
revoke execute on function public.restore_company(uuid, jsonb) from anon, authenticated, public;
grant execute on function public.restore_company(uuid, jsonb) to service_role;

-- ── 11. Grants and checks ────────────────────────────────────────────────────
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


-- ══════════════════════════════ 2026-10-26_sync_job_status.sql ══════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- Office job status follows the ride.                          (2026-10-26)
--
-- When a ride is completed (by the driver app, the dispatch board or anyone)
-- or cancelled, the office "Job status" moves from Processing to Completed /
-- Cancelled automatically. A job status staff set by hand (On hold, Refunded …)
-- is never overwritten — only Processing follows the ride.
--
-- Also fixes the jobs already completed/cancelled that still say Processing.
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

create or replace function public.sync_job_status()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.status is distinct from old.status
     and coalesce(new.job_status, 'processing') = 'processing' then
    if new.status = 'completed' then
      new.job_status := 'completed';
    elsif new.status = 'cancelled' then
      new.job_status := 'cancelled';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_job_status on public.bookings;
create trigger trg_sync_job_status
  before update of status on public.bookings
  for each row execute function public.sync_job_status();

-- Existing jobs: only job_status changes, so no texts, emails or pushes fire.
update public.bookings set job_status = 'completed' where status = 'completed' and job_status = 'processing';
update public.bookings set job_status = 'cancelled' where status = 'cancelled' and job_status = 'processing';

commit;


-- ══════════════════════════════ 2026-10-27_manual_billing.sql ══════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- Manual subscription billing                                     (2026-10-27)
--
-- Companies' subscriptions are no longer taken through the platform owner's
-- Stripe. The platform keeps its own list of invoices instead: a few days
-- before each company's billing date it adds the next invoice ("upcoming");
-- the owner sends a payment link by email or WhatsApp, marks it "sent", and
-- marks it "paid" once the money arrives — so nobody is asked twice.
--
--   • platform_invoices — one row per company per monthly period. Only the
--     app's server reads or writes it (no access rules for any login).
--   • companies.billing_paused — "don't create invoices for this company"
--     (billed some other way, or free); companies.owner_phone — for sending
--     payment links by WhatsApp; company status "pending" — a sign-up waiting
--     for the owner's approval.
--   • platform_generate_invoices(days_ahead) — called daily: adds the next
--     invoice for every open company whose billing date is within days_ahead,
--     and marks companies with an unpaid invoice past its due date "overdue".
--   • platform_mark_invoice_paid / platform_unmark_invoice_paid — paid moves
--     the company's paid-until date on by the invoice's period (and ends the
--     trial); undo puts it back.
--
-- A company's next billing date is the end of the period it has paid for
-- (current_period_end), else the end of its free trial, else the day it was
-- created. Until that invoice is paid the date doesn't move, so there is only
-- ever one invoice per period — no double billing.
--
-- Safe to run more than once. Runs after 2026-10-24_platform.sql.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

alter table public.companies add column if not exists billing_paused boolean not null default false;
-- Where to send payment links by WhatsApp (asked for at sign-up).
alter table public.companies add column if not exists owner_phone text;

-- Sign-ups wait for the owner's approval: status "pending" (switched off like
-- suspended — no booking page, no logins working, no invoices) until approved.
alter table public.companies drop constraint if exists companies_status_check;
alter table public.companies add constraint companies_status_check
  check (status in ('pending', 'trialing', 'active', 'past_due', 'suspended', 'cancelled'));

create sequence if not exists public.platform_invoice_seq;

create table if not exists public.platform_invoices (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  number        text not null default ('INV-' || to_char(now() at time zone 'Europe/London', 'YYYY') || '-'
                                       || lpad(nextval('public.platform_invoice_seq')::text, 4, '0')),
  plan_name     text,
  amount        numeric(10,2) not null check (amount >= 0),
  currency      text not null default 'gbp',
  period_start  date not null,
  period_end    date not null,
  due_date      date not null,
  status        text not null default 'upcoming' check (status in ('upcoming', 'sent', 'paid', 'cancelled')),
  sent_at       timestamptz,
  sent_via      text,
  -- The payment link sent to the company (shown on its Plan & billing page).
  payment_link  text,
  paid_at       timestamptz,
  paid_note     text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- One live invoice per company per period (a cancelled one can be replaced).
create unique index if not exists platform_invoices_period_key
  on public.platform_invoices (company_id, period_start) where status <> 'cancelled';
create index if not exists platform_invoices_status_idx on public.platform_invoices (status, due_date);
create index if not exists platform_invoices_company_idx on public.platform_invoices (company_id, period_start desc);

alter table public.platform_invoices enable row level security;
-- No policies on purpose: only the app's server (service role) reads or writes.

-- Today in the UK.
create or replace function public.uk_today()
returns date language sql stable as $$ select (now() at time zone 'Europe/London')::date $$;

create or replace function public.platform_generate_invoices(p_days_ahead int default 7)
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  r record;
  v_start date;
  n int := 0;
begin
  for r in
    select c.id, c.current_period_end, c.trial_ends_at, c.created_at, p.name as plan_name, p.price_monthly, p.currency
      from companies c join plans p on p.id = c.plan_id
     where c.status in ('trialing', 'active', 'past_due') and not c.billing_paused and p.price_monthly > 0
  loop
    v_start := (coalesce(r.current_period_end, r.trial_ends_at, r.created_at) at time zone 'Europe/London')::date;
    if v_start <= uk_today() + greatest(p_days_ahead, 0)
       and not exists (select 1 from platform_invoices i where i.company_id = r.id and i.period_start = v_start and i.status <> 'cancelled') then
      insert into platform_invoices (company_id, plan_name, amount, currency, period_start, period_end, due_date)
      values (r.id, r.plan_name, r.price_monthly, coalesce(r.currency, 'gbp'), v_start, (v_start + interval '1 month')::date, v_start);
      n := n + 1;
    end if;
  end loop;

  -- An unpaid invoice past its due date: the company shows "Payment overdue"
  -- (it keeps working; suspending is the owner's decision).
  update companies c set status = 'past_due', updated_at = now()
   where c.status in ('trialing', 'active')
     and exists (select 1 from platform_invoices i where i.company_id = c.id and i.status in ('upcoming', 'sent') and i.due_date < uk_today());
  return n;
end $$;

create or replace function public.platform_mark_invoice_paid(p_invoice uuid, p_paid_at timestamptz default now(), p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  inv platform_invoices%rowtype;
  v_end timestamptz;
begin
  select * into inv from platform_invoices where id = p_invoice for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if inv.status = 'cancelled' then return jsonb_build_object('ok', false, 'error', 'cancelled'); end if;
  if inv.status = 'paid' then return jsonb_build_object('ok', true, 'already', true); end if;

  update platform_invoices
     set status = 'paid', paid_at = coalesce(p_paid_at, now()), paid_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
   where id = p_invoice;

  v_end := (inv.period_end::timestamp at time zone 'Europe/London');
  update companies c
     set current_period_end = greatest(coalesce(c.current_period_end, v_end), v_end),
         status = case
           when c.status in ('trialing', 'past_due')
                and not exists (select 1 from platform_invoices i where i.company_id = c.id and i.id <> p_invoice
                                  and i.status in ('upcoming', 'sent') and i.due_date < uk_today())
           then 'active' else c.status end,
         updated_at = now()
   where c.id = inv.company_id;
  return jsonb_build_object('ok', true);
end $$;

-- Undo "paid" (marked by mistake): back to sent (or upcoming), and the
-- company's paid-until date back to the start of that period.
create or replace function public.platform_unmark_invoice_paid(p_invoice uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  inv platform_invoices%rowtype;
begin
  select * into inv from platform_invoices where id = p_invoice for update;
  if not found or inv.status <> 'paid' then return jsonb_build_object('ok', false, 'error', 'not_paid'); end if;
  update platform_invoices
     set status = case when sent_at is null then 'upcoming' else 'sent' end, paid_at = null, paid_note = null, updated_at = now()
   where id = p_invoice;
  update companies
     set current_period_end = (inv.period_start::timestamp at time zone 'Europe/London'), updated_at = now()
   where id = inv.company_id
     and current_period_end = (inv.period_end::timestamp at time zone 'Europe/London');
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.platform_generate_invoices(int) from anon, authenticated, public;
revoke execute on function public.platform_mark_invoice_paid(uuid, timestamptz, text) from anon, authenticated, public;
revoke execute on function public.platform_unmark_invoice_paid(uuid) from anon, authenticated, public;
grant execute on function public.platform_generate_invoices(int) to service_role;
grant execute on function public.platform_mark_invoice_paid(uuid, timestamptz, text) to service_role;
grant execute on function public.platform_unmark_invoice_paid(uuid) to service_role;
grant all on public.platform_invoices to service_role;
grant usage on sequence public.platform_invoice_seq to service_role;

-- Per-company backups/restores don't include invoices on purpose: billing
-- history belongs to the platform, not to the company's restorable data.

notify pgrst, 'reload schema';

commit;

