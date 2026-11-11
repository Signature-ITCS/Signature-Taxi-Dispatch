-- ─────────────────────────────────────────────────────────────────────────────
-- Corporate accounts & monthly invoices      (from Black Falcon acd4245, multi-company)
--
--   accounts            a company's corporate customers (invoice email, address)
--   bookings.account_id a journey booked on an account (payment_method = 'account':
--                       nothing to collect from the passenger — it's invoiced)
--   invoices            one per account per calendar month, emailed as a PDF
--
-- Multi-company:
--   • every row has company_id (filled by tenant_guard, checked by RLS);
--   • a booking or invoice can only point at an account of its own company;
--   • invoice numbers count per company (INV-1001, INV-1002 … for each);
--   • backups and "Restore one company" include accounts and invoices.
--
-- The monthly run is the app's daily keep-alive cron (first week of each month),
-- not pg_cron — nothing to schedule here.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Must run on its own (Postgres won't use a new enum value in the same transaction).
alter type public.payment_method add value if not exists 'account';

begin;

create table if not exists public.accounts (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  name           text not null,                -- shown on the invoice
  contact_name   text,
  email          text,                         -- where invoices are emailed (comma-separate several)
  phone          text,
  address        text,                         -- billing address, shown on the invoice
  notes          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists accounts_company_name_idx on public.accounts (company_id, lower(name));

alter table public.bookings add column if not exists account_id uuid references public.accounts(id) on delete set null;
create index if not exists bookings_account_idx on public.bookings (account_id, scheduled_at) where account_id is not null;

-- "On account" only ever with an account behind it. Bookings are created through
-- the public create_booking RPC as cash/card; only the app's server (staff session
-- checked) switches them to an account, so a crafted public request can't book
-- a free "account" ride. (Compared as text: the new enum value can't be used in
-- the transaction that adds it.)
alter table public.bookings drop constraint if exists bookings_account_payment_chk;
alter table public.bookings add constraint bookings_account_payment_chk
  check (payment_method::text <> 'account' or account_id is not null);

create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  invoice_number  text not null,
  account_id      uuid not null references public.accounts(id) on delete cascade,
  period_start    date not null,               -- first day of the month invoiced
  period_end      date not null,               -- last day of that month
  journeys        integer not null default 0,
  total           numeric(10,2) not null default 0,
  booking_ids     uuid[] not null default '{}',
  issued_at       timestamptz not null default now(),
  emailed_at      timestamptz,
  emailed_to      text,
  email_error     text,
  paid_at         timestamptz,
  unique (company_id, invoice_number),
  unique (account_id, period_start)
);
create index if not exists invoices_company_idx on public.invoices (company_id, period_start desc);

-- Invoice numbers, per company.
create table if not exists public.account_invoice_counters (
  company_id uuid primary key references public.companies(id) on delete cascade,
  next_no    integer not null default 1001
);
alter table public.account_invoice_counters enable row level security;
revoke all on public.account_invoice_counters from anon, authenticated;

drop function if exists public.next_invoice_number();
create or replace function public.next_invoice_number(p_company uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  if p_company is null or not exists (select 1 from companies where id = p_company) then
    raise exception 'No such company';
  end if;
  insert into account_invoice_counters as c (company_id, next_no) values (p_company, 1002)
  on conflict (company_id) do update set next_no = c.next_no + 1
  returning next_no - 1 into n;
  return 'INV-' || n::text;
end $$;
revoke execute on function public.next_invoice_number(uuid) from public, anon, authenticated;
grant execute on function public.next_invoice_number(uuid) to service_role;

-- company_id filled in / never moved (the platform's tenant guard)…
drop trigger if exists a_tenant_guard on public.accounts;
create trigger a_tenant_guard before insert or update on public.accounts
  for each row execute function public.tenant_guard();
drop trigger if exists a_tenant_guard on public.invoices;
create trigger a_tenant_guard before insert or update on public.invoices
  for each row execute function public.tenant_guard();

-- …and an account reference must be in the same company.
create or replace function public.guard_account_ref()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v uuid;
begin
  if new.account_id is not null then
    select company_id into v from accounts where id = new.account_id;
    if v is distinct from new.company_id then
      raise exception 'Cross-company reference blocked: %.account_id', tg_table_name;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.guard_account_ref() from public, anon, authenticated;

-- Named to run right after a_tenant_guard (which fills company_id).
drop trigger if exists a_tenant_guard_account on public.bookings;
create trigger a_tenant_guard_account before insert or update of account_id, company_id on public.bookings
  for each row execute function public.guard_account_ref();
drop trigger if exists a_tenant_guard_account on public.invoices;
create trigger a_tenant_guard_account before insert or update on public.invoices
  for each row execute function public.guard_account_ref();

-- Row-level security: the company's office staff only.
alter table public.accounts enable row level security;
alter table public.invoices enable row level security;
revoke all on public.accounts, public.invoices from anon;
drop policy if exists "company_staff_all" on public.accounts;
create policy "company_staff_all" on public.accounts for all to authenticated
  using (company_id = (select current_company_id()) and (select is_staff()))
  with check (company_id = (select current_company_id()) and (select is_staff()));
drop policy if exists "company_staff_all" on public.invoices;
create policy "company_staff_all" on public.invoices for all to authenticated
  using (company_id = (select current_company_id()) and (select is_staff()))
  with check (company_id = (select current_company_id()) and (select is_staff()));

-- ── Backups: "Restore one company" now brings back accounts and invoices too ──
-- (Older backups have neither: then the company's current accounts are kept.)
create or replace function public.restore_company(p_company uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  has_accounts boolean := (p_data -> 'tables') ? 'accounts';
  -- Children first for deleting; reversed for inserting.
  t_delete text[] := array[
    'staff_notifications', 'ride_events', 'ratings', 'payments', 'cash_settlements',
    'push_subscriptions', 'driver_locations', 'checkout_drafts', 'invoices', 'bookings', 'accounts', 'customers',
    'vehicles', 'drivers', 'fixed_routes', 'pricing_zones', 'pricing_bands', 'pricing_rules',
    'vehicle_categories', 'websites', 'app_settings', 'activity_logs'];
  t_insert text[] := array[
    'app_settings', 'websites', 'vehicle_categories', 'pricing_rules', 'pricing_bands',
    'pricing_zones', 'fixed_routes', 'drivers', 'vehicles', 'customers', 'accounts', 'bookings', 'invoices',
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
    if t in ('accounts', 'invoices') and not has_accounts then continue; end if;
    execute format('delete from public.%I where company_id = $1', t) using p_company;
  end loop;

  foreach t in array t_insert loop
    if t in ('accounts', 'invoices') and not has_accounts then continue; end if;
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
      -- An account reference must be one of this company's accounts (as restored).
      rows := coalesce((select jsonb_agg(case when (r ->> 'account_id') is null
                                                or exists (select 1 from accounts a where a.id = (r ->> 'account_id')::uuid and a.company_id = p_company)
                                              then r else r || '{"account_id": null, "payment_method": "cash"}'::jsonb end)
                          from jsonb_array_elements(rows) r), '[]'::jsonb);
    elsif t = 'invoices' then
      rows := coalesce((select jsonb_agg(r) from jsonb_array_elements(rows) r
                         where exists (select 1 from accounts a where a.id = (r ->> 'account_id')::uuid and a.company_id = p_company)), '[]'::jsonb);
    end if;
    execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)', t, t) using rows;
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object(t, n);
  end loop;

  -- Invoice numbers carry on after the highest restored one.
  if has_accounts then
    insert into account_invoice_counters (company_id, next_no)
    select p_company, coalesce(max(nullif(regexp_replace(invoice_number, '\D', '', 'g'), '')::int), 1000) + 1
      from invoices where company_id = p_company
    on conflict (company_id) do update set next_no = greatest(account_invoice_counters.next_no, excluded.next_no);
  end if;

  foreach t in array t_delete loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;

  return jsonb_build_object('ok', true, 'rows', counts);
end $$;
revoke execute on function public.restore_company(uuid, jsonb) from anon, authenticated, public;
grant execute on function public.restore_company(uuid, jsonb) to service_role;

commit;
