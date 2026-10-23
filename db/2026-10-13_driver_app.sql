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
