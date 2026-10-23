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
