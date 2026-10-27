-- ─────────────────────────────────────────────────────────────────────────────
-- Partner network                                                 (2026-10-29)
--
-- Independent drivers and sole-trader operators who join the platform (and pay
-- the platform owner monthly) so that companies can find someone to cover a
-- job and contact them on WhatsApp.
--
--   • partners — one row per partner: licensing council, badge, vehicle
--     licence, operator licence, vehicle, areas, "available now", and the
--     owner's controls (status, paid until, private notes).
--   • partner_contacts — which company (and who) asked for a partner's number.
--   • partner_reports — a company's complaint about a partner.
--
-- Private: no access rules for any login. Only the app's server reads these,
-- and it shows the directory only to signed-in office staff of open companies
-- and to the platform owner — and only partners who are approved, paid up and
-- whose licences haven't expired (src/lib/partners.ts isListed). Phone numbers are given
-- out one at a time, on "WhatsApp", and every such request is logged.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

create table if not exists public.partners (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid unique references auth.users(id) on delete set null,
  status                   text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  full_name                text not null,
  email                    text not null unique,
  phone                    text not null,
  -- driver = licensed driver; operator = also holds a private hire operator licence
  kind                     text not null default 'driver' check (kind in ('driver', 'operator')),
  council                  text not null,
  badge_number             text not null,
  badge_expires            date not null,
  vehicle_type             text,
  vehicle_make             text,
  vehicle_model            text,
  vehicle_colour           text,
  vehicle_seats            int check (vehicle_seats between 1 and 20),
  plate_number             text,
  vehicle_licence_number   text,
  vehicle_licence_expires  date,
  operator_licence_number  text,
  operator_council         text,
  operator_licence_expires date,
  areas                    text not null default '',
  about                    text,
  available                boolean not null default false,
  available_until          timestamptz,
  available_changed_at     timestamptz,
  paid_until               date,
  owner_notes              text,
  approved_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists partners_status_idx on public.partners (status, paid_until);

create table if not exists public.partner_contacts (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id) on delete cascade,
  company_id  uuid references public.companies(id) on delete set null,
  user_id     uuid,
  user_name   text,
  created_at  timestamptz not null default now()
);
create index if not exists partner_contacts_partner_idx on public.partner_contacts (partner_id, created_at desc);

create table if not exists public.partner_reports (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id) on delete cascade,
  company_id  uuid references public.companies(id) on delete set null,
  user_id     uuid,
  user_name   text,
  reason      text not null,
  status      text not null default 'new' check (status in ('new', 'reviewed')),
  created_at  timestamptz not null default now()
);

alter table public.partners         enable row level security;
alter table public.partner_contacts enable row level security;
alter table public.partner_reports  enable row level security;
-- No policies on purpose: only the app's server (service role) reads or writes.
revoke all on public.partners, public.partner_contacts, public.partner_reports from anon, authenticated;
grant all on public.partners, public.partner_contacts, public.partner_reports to service_role;

-- The monthly price shown on the join page (pounds; 0 = not shown).
insert into public.platform_settings (key, value)
values ('partners', jsonb_build_object('monthly_price', 15))
on conflict (key) do nothing;

notify pgrst, 'reload schema';

commit;
