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
  'booking_status_url', 'https://booking.airport-transfer.uk/api/webhooks/booking-status'
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
-- letters/digits — "Signature Transfers" is too long). Only filled in where
-- still blank (or the "Taxi Co" placeholder): anything already set in
-- Admin → Settings is left alone.
update public.app_settings
   set value = jsonb_set(value, '{name}', '"Signature Transfers"'), updated_at = now()
 where key = 'company' and coalesce(value->>'name', '') in ('', 'Taxi Co');
update public.app_settings
   set value = jsonb_set(value, '{sms_sender}', '"Signature"'), updated_at = now()
 where key = 'notifications' and coalesce(value->>'sms_sender', '') = '';

commit;
