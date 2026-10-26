-- ─────────────────────────────────────────────────────────────────────────────
-- Office job status follows the ride.                          (2026-10-26)
--
-- When a ride is completed (by the driver app, the dispatch board or anyone)
-- or cancelled, the office "Job status" moves from Processing to Completed /
-- Cancelled automatically. A job status staff set by hand (On hold, Refunded …)
-- is never overwritten — only Processing follows the ride.
--
-- Also fixes the jobs already completed/cancelled that still say Processing.
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

create or replace function public.sync_job_status()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.status is distinct from old.status
     and coalesce(new.job_status, 'processing') = 'processing' then
    if new.status = 'completed' then
      new.job_status := 'completed';
    elsif new.status = 'cancelled' then
      new.job_status := 'cancelled';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_job_status on public.bookings;
create trigger trg_sync_job_status
  before update of status on public.bookings
  for each row execute function public.sync_job_status();

-- Existing jobs: only job_status changes, so no texts, emails or pushes fire.
update public.bookings set job_status = 'completed' where status = 'completed' and job_status = 'processing';
update public.bookings set job_status = 'cancelled' where status = 'cancelled' and job_status = 'processing';

commit;
