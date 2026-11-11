-- ─────────────────────────────────────────────────────────────────────────────
-- Driver commission                       (from Black Falcon ad791d7, multi-company)
--
--   drivers.commission_percent   the company's cut of each fare for this driver
--                                (Admin → Drivers; 0–100; empty = not set)
--   bookings.commission_percent  the rate that applied to the job, copied from
--                                the driver when the ride is completed, so a
--                                later rate change doesn't rewrite old reports.
--
-- Multi-company: the rate is only copied when the driver belongs to the same
-- company as the booking. Existing RLS on drivers/bookings already keeps each
-- company to its own rows. Staff reports only; customers never see it.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

alter table public.drivers add column if not exists commission_percent numeric(5,2);
alter table public.drivers drop constraint if exists drivers_commission_percent_chk;
alter table public.drivers add constraint drivers_commission_percent_chk
  check (commission_percent is null or (commission_percent >= 0 and commission_percent <= 100));

alter table public.bookings add column if not exists commission_percent numeric(5,2);
alter table public.bookings drop constraint if exists bookings_commission_percent_chk;
alter table public.bookings add constraint bookings_commission_percent_chk
  check (commission_percent is null or (commission_percent >= 0 and commission_percent <= 100));
comment on column public.bookings.commission_percent is
  'Company commission % that applied to this job (copied from the driver on completion).';

create or replace function public.snapshot_driver_commission()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.status = 'completed'
     and new.driver_id is not null
     and new.commission_percent is null
     and (tg_op = 'INSERT' or old.status is distinct from 'completed' or old.driver_id is distinct from new.driver_id) then
    select d.commission_percent into new.commission_percent
      from drivers d
     where d.id = new.driver_id
       and d.company_id = new.company_id;
  end if;
  return new;
end $$;

-- A trigger function is never meant to be called directly.
revoke execute on function public.snapshot_driver_commission() from public, anon, authenticated;

drop trigger if exists trg_snapshot_driver_commission on public.bookings;
create trigger trg_snapshot_driver_commission
  before insert or update of status, driver_id on public.bookings
  for each row execute function public.snapshot_driver_commission();

commit;
