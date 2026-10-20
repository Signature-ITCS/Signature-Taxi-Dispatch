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
