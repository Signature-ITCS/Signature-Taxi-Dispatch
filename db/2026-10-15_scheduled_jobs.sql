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
