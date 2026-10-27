-- ─────────────────────────────────────────────────────────────────────────────
-- Two-factor sign-in (authenticator app)                          (2026-10-28)
--
-- Supabase Auth's TOTP factors (Google / Microsoft Authenticator, Authy…). A
-- sign-in that has passed the code carries "aal2" in its token.
--
--   • Anyone who has set up an authenticator must have entered its code in this
--     session, or the database gives them nothing — not through the website
--     and not through Supabase's API with a stolen password.
--   • companies.require_2fa — the company requires it for its office staff
--     (admins and dispatchers): without an authenticator they get nothing until
--     they set one up. Drivers are never required.
--   • The platform owner always needs it; that is enforced by the app, which
--     is the only way into the master dashboard.
--
-- It all goes through current_company_id(), which every company security rule
-- is built on. Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

alter table public.companies add column if not exists require_2fa boolean not null default false;

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
       -- …or the user has no authenticator, and their company doesn't require
       -- one for them (drivers are never required).
       or (
         not exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified')
         and (not c.require_2fa or p.role = 'driver')
       )
     );
$$;

notify pgrst, 'reload schema';

commit;
