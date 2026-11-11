-- ─────────────────────────────────────────────────────────────────────────────
-- Two-factor sign-in (authenticator app) switched OFF            (2026-11-12)
--
-- current_company_id() goes back to: an active login of an open company.
-- No authenticator code is needed, whether or not one was set up.
--
-- Nothing is deleted: authenticators people already set up, the grace dates
-- and each company's "require" setting all stay, so it can be switched back on
-- by re-running db/2026-10-28_two_factor_grace.sql (and setting
-- TWO_FACTOR_ENABLED = true in src/lib/twoFactor.ts).
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select p.company_id
    from profiles p
    join companies c on c.id = p.company_id
   where p.id = auth.uid() and p.is_active
     and c.status in ('trialing', 'active', 'past_due');
$$;
grant execute on function public.current_company_id() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
