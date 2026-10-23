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
