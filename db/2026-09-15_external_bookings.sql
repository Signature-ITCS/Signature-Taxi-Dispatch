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
