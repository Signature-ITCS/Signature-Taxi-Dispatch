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
