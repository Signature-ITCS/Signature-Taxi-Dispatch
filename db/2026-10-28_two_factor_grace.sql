-- ─────────────────────────────────────────────────────────────────────────────
-- Two-factor sign-in for every office login, after 3 days' grace   (2026-10-28)
--
-- Every admin and dispatcher must set up an authenticator. A new login gets 3
-- days to do it (prompted at each sign-in meanwhile); after that the database
-- gives them nothing until they have. Drivers are never asked.
--
--   • profiles.two_factor_due_at — when the grace ends. New logins: 3 days
--     from creation; a sign-up's owner: 3 days from when the platform owner
--     approves it (the app sets it then). Existing logins: 3 days from now.
--   • companies.require_2fa (from 2026-10-28_two_factor.sql) now means "no
--     grace" — required straight away for that company's office staff.
--
-- Runs after 2026-10-28_two_factor.sql. Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

alter table public.profiles add column if not exists two_factor_due_at timestamptz not null default (now() + interval '3 days');

create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select p.company_id
    from profiles p
    join companies c on c.id = p.company_id
   where p.id = auth.uid() and p.is_active
     and c.status in ('trialing', 'active', 'past_due')
     and (
       -- This session passed the authenticator code…
       coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
       -- …or the user has no authenticator yet and doesn't need one yet:
       -- drivers never; office staff during their grace period, unless their
       -- company requires it straight away.
       or (
         not exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified')
         and (p.role = 'driver' or (not c.require_2fa and p.two_factor_due_at > now()))
       )
     );
$$;

-- Nobody signed in may move a grace date — not their own, not their staff's
-- (only the app's server does, e.g. when a sign-up is approved).
create or replace function public.guard_two_factor_due()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.two_factor_due_at := now() + interval '3 days';
    elsif new.two_factor_due_at is distinct from old.two_factor_due_at then
      raise exception 'two_factor_due_at can only be changed by the platform';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists b_guard_two_factor_due on public.profiles;
create trigger b_guard_two_factor_due before insert or update of two_factor_due_at on public.profiles
  for each row execute function public.guard_two_factor_due();

notify pgrst, 'reload schema';

commit;
