-- ─────────────────────────────────────────────────────────────────────────────
-- Manual subscription billing                                     (2026-10-27)
--
-- Companies' subscriptions are no longer taken through the platform owner's
-- Stripe. The platform keeps its own list of invoices instead: a few days
-- before each company's billing date it adds the next invoice ("upcoming");
-- the owner sends a payment link by email or WhatsApp, marks it "sent", and
-- marks it "paid" once the money arrives — so nobody is asked twice.
--
--   • platform_invoices — one row per company per monthly period. Only the
--     app's server reads or writes it (no access rules for any login).
--   • companies.billing_paused — "don't create invoices for this company"
--     (billed some other way, or free); companies.owner_phone — for sending
--     payment links by WhatsApp.
--   • platform_generate_invoices(days_ahead) — called daily: adds the next
--     invoice for every open company whose billing date is within days_ahead,
--     and marks companies with an unpaid invoice past its due date "overdue".
--   • platform_mark_invoice_paid / platform_unmark_invoice_paid — paid moves
--     the company's paid-until date on by the invoice's period (and ends the
--     trial); undo puts it back.
--
-- A company's next billing date is the end of the period it has paid for
-- (current_period_end), else the end of its free trial, else the day it was
-- created. Until that invoice is paid the date doesn't move, so there is only
-- ever one invoice per period — no double billing.
--
-- Safe to run more than once. Runs after 2026-10-24_platform.sql.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

alter table public.companies add column if not exists billing_paused boolean not null default false;
-- Where to send payment links by WhatsApp (asked for at sign-up).
alter table public.companies add column if not exists owner_phone text;

create sequence if not exists public.platform_invoice_seq;

create table if not exists public.platform_invoices (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  number        text not null default ('INV-' || to_char(now() at time zone 'Europe/London', 'YYYY') || '-'
                                       || lpad(nextval('public.platform_invoice_seq')::text, 4, '0')),
  plan_name     text,
  amount        numeric(10,2) not null check (amount >= 0),
  currency      text not null default 'gbp',
  period_start  date not null,
  period_end    date not null,
  due_date      date not null,
  status        text not null default 'upcoming' check (status in ('upcoming', 'sent', 'paid', 'cancelled')),
  sent_at       timestamptz,
  sent_via      text,
  -- The payment link sent to the company (shown on its Plan & billing page).
  payment_link  text,
  paid_at       timestamptz,
  paid_note     text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- One live invoice per company per period (a cancelled one can be replaced).
create unique index if not exists platform_invoices_period_key
  on public.platform_invoices (company_id, period_start) where status <> 'cancelled';
create index if not exists platform_invoices_status_idx on public.platform_invoices (status, due_date);
create index if not exists platform_invoices_company_idx on public.platform_invoices (company_id, period_start desc);

alter table public.platform_invoices enable row level security;
-- No policies on purpose: only the app's server (service role) reads or writes.

-- Today in the UK.
create or replace function public.uk_today()
returns date language sql stable as $$ select (now() at time zone 'Europe/London')::date $$;

create or replace function public.platform_generate_invoices(p_days_ahead int default 7)
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  r record;
  v_start date;
  n int := 0;
begin
  for r in
    select c.id, c.current_period_end, c.trial_ends_at, c.created_at, p.name as plan_name, p.price_monthly, p.currency
      from companies c join plans p on p.id = c.plan_id
     where c.status in ('trialing', 'active', 'past_due') and not c.billing_paused and p.price_monthly > 0
  loop
    v_start := (coalesce(r.current_period_end, r.trial_ends_at, r.created_at) at time zone 'Europe/London')::date;
    if v_start <= uk_today() + greatest(p_days_ahead, 0)
       and not exists (select 1 from platform_invoices i where i.company_id = r.id and i.period_start = v_start and i.status <> 'cancelled') then
      insert into platform_invoices (company_id, plan_name, amount, currency, period_start, period_end, due_date)
      values (r.id, r.plan_name, r.price_monthly, coalesce(r.currency, 'gbp'), v_start, (v_start + interval '1 month')::date, v_start);
      n := n + 1;
    end if;
  end loop;

  -- An unpaid invoice past its due date: the company shows "Payment overdue"
  -- (it keeps working; suspending is the owner's decision).
  update companies c set status = 'past_due', updated_at = now()
   where c.status in ('trialing', 'active')
     and exists (select 1 from platform_invoices i where i.company_id = c.id and i.status in ('upcoming', 'sent') and i.due_date < uk_today());
  return n;
end $$;

create or replace function public.platform_mark_invoice_paid(p_invoice uuid, p_paid_at timestamptz default now(), p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  inv platform_invoices%rowtype;
  v_end timestamptz;
begin
  select * into inv from platform_invoices where id = p_invoice for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if inv.status = 'cancelled' then return jsonb_build_object('ok', false, 'error', 'cancelled'); end if;
  if inv.status = 'paid' then return jsonb_build_object('ok', true, 'already', true); end if;

  update platform_invoices
     set status = 'paid', paid_at = coalesce(p_paid_at, now()), paid_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
   where id = p_invoice;

  v_end := (inv.period_end::timestamp at time zone 'Europe/London');
  update companies c
     set current_period_end = greatest(coalesce(c.current_period_end, v_end), v_end),
         status = case
           when c.status in ('trialing', 'past_due')
                and not exists (select 1 from platform_invoices i where i.company_id = c.id and i.id <> p_invoice
                                  and i.status in ('upcoming', 'sent') and i.due_date < uk_today())
           then 'active' else c.status end,
         updated_at = now()
   where c.id = inv.company_id;
  return jsonb_build_object('ok', true);
end $$;

-- Undo "paid" (marked by mistake): back to sent (or upcoming), and the
-- company's paid-until date back to the start of that period.
create or replace function public.platform_unmark_invoice_paid(p_invoice uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  inv platform_invoices%rowtype;
begin
  select * into inv from platform_invoices where id = p_invoice for update;
  if not found or inv.status <> 'paid' then return jsonb_build_object('ok', false, 'error', 'not_paid'); end if;
  update platform_invoices
     set status = case when sent_at is null then 'upcoming' else 'sent' end, paid_at = null, paid_note = null, updated_at = now()
   where id = p_invoice;
  update companies
     set current_period_end = (inv.period_start::timestamp at time zone 'Europe/London'), updated_at = now()
   where id = inv.company_id
     and current_period_end = (inv.period_end::timestamp at time zone 'Europe/London');
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.platform_generate_invoices(int) from anon, authenticated, public;
revoke execute on function public.platform_mark_invoice_paid(uuid, timestamptz, text) from anon, authenticated, public;
revoke execute on function public.platform_unmark_invoice_paid(uuid) from anon, authenticated, public;
grant execute on function public.platform_generate_invoices(int) to service_role;
grant execute on function public.platform_mark_invoice_paid(uuid, timestamptz, text) to service_role;
grant execute on function public.platform_unmark_invoice_paid(uuid) to service_role;
grant all on public.platform_invoices to service_role;
grant usage on sequence public.platform_invoice_seq to service_role;

-- Per-company backups/restores don't include invoices on purpose: billing
-- history belongs to the platform, not to the company's restorable data.

notify pgrst, 'reload schema';

commit;
