-- ─────────────────────────────────────────────────────────────────────────────
-- Shared rate limits                                               (2026-10-29)
--
-- The app's request limits (sign-ups, partner applications, password resets,
-- bookings, address look-ups…) were counted in each server's memory, so a bot
-- spread across Vercel's servers got more tries than the limit. This keeps the
-- count in the database, shared by every server.
--
--   hit_rate_limit(key, limit, window_seconds) → true if allowed. Fixed window:
--   the first hit opens a window; hits inside it are counted; the next hit
--   after it ends opens a new one. Server only (service role).
--
-- Old windows are removed now and then by the function itself. Safe to run
-- more than once.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

create table if not exists public.rate_limits (
  key           text primary key,
  window_start  timestamptz not null default now(),
  hits          int not null default 1
);
alter table public.rate_limits enable row level security;
-- No policies: server only.
revoke all on public.rate_limits from anon, authenticated;
grant all on public.rate_limits to service_role;

create or replace function public.hit_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare
  n int;
begin
  insert into rate_limits as r (key, window_start, hits) values (left(p_key, 200), now(), 1)
  on conflict (key) do update set
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end,
    hits         = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end
  returning hits into n;
  -- Now and then, clear windows older than a day.
  if random() < 0.01 then
    delete from rate_limits where window_start < now() - interval '1 day';
  end if;
  return n <= p_limit;
end $$;
revoke execute on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, int, int) to service_role;

notify pgrst, 'reload schema';

commit;
