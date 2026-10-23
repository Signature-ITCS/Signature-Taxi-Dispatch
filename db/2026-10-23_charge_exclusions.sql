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
