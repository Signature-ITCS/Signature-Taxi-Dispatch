-- Stripe hardening (2026-09-12)
--
-- 1. payments.stripe_payment_intent_id becomes UNIQUE  → one PaymentIntent can
--    only ever be credited to ONE booking. This is the DB-level backstop for the
--    replay guard in /api/book (pay once, book many times).
-- 2. Review / orphan columns so a payment that arrives without a matching
--    booking (browser died mid-checkout) is visible instead of silently lost.
-- 3. stripe_events → webhook idempotency. Stripe retries deliveries; we must
--    process each event exactly once.
--
-- Safe to re-run. Existing duplicate PaymentIntent rows are NOT deleted — the
-- later copies are unlinked from the intent and flagged for review so the
-- unique index can be created without losing history.
begin;

-- ── 1. Extra columns on payments ────────────────────────────────────────────
alter table public.payments add column if not exists currency        text        not null default 'gbp';
alter table public.payments add column if not exists amount_refunded numeric     not null default 0;
alter table public.payments add column if not exists needs_review    boolean     not null default false;
alter table public.payments add column if not exists review_reason   text;
alter table public.payments add column if not exists failure_reason  text;
alter table public.payments add column if not exists disputed_at     timestamptz;
alter table public.payments add column if not exists alerted_at      timestamptz;
alter table public.payments add column if not exists updated_at      timestamptz not null default now();

comment on column public.payments.needs_review is
  'Money moved but something did not line up (orphan payment, amount/trip mismatch, reused intent). Staff must check and refund or attach manually.';
comment on column public.payments.alerted_at is
  'When the "unmatched payment" alert email was sent to staff. Null = not yet alerted.';

-- ── 2. De-duplicate before adding the unique index ──────────────────────────
-- Keep the OLDEST row per PaymentIntent. Later copies keep their booking link
-- and amount (history is preserved) but lose the intent id and are flagged.
with ranked as (
  select id,
         stripe_payment_intent_id,
         row_number() over (
           partition by stripe_payment_intent_id order by created_at asc, id asc
         ) as rn
  from public.payments
  where stripe_payment_intent_id is not null
)
update public.payments p
   set stripe_payment_intent_id = null,
       needs_review  = true,
       review_reason = coalesce(p.review_reason, '')
                     || 'Duplicate of PaymentIntent ' || r.stripe_payment_intent_id
                     || ' — this booking may have been credited without a separate payment. ',
       updated_at    = now()
  from ranked r
 where p.id = r.id
   and r.rn > 1;

create unique index if not exists payments_stripe_payment_intent_id_key
  on public.payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- Fast lookup for the orphan sweep + admin Payments page
create index if not exists payments_review_idx
  on public.payments (needs_review, created_at desc);
create index if not exists payments_booking_idx
  on public.payments (booking_id);

-- ── 3. Webhook event de-duplication ─────────────────────────────────────────
create table if not exists public.stripe_events (
  id            text primary key,               -- Stripe event id (evt_...)
  type          text        not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text
);

comment on table public.stripe_events is
  'One row per Stripe webhook event. Insert-first gives exactly-once processing: Stripe retries a delivery, the primary key rejects it, we return 200.';

-- Service role only (the webhook runs with the service key and bypasses RLS
-- anyway). No anon/authenticated policies → nothing is publicly readable.
alter table public.stripe_events enable row level security;

-- ── 4. Keep payments.updated_at fresh ───────────────────────────────────────
create or replace function public.touch_payments_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists payments_touch_updated_at on public.payments;
create trigger payments_touch_updated_at
  before update on public.payments
  for each row execute function public.touch_payments_updated_at();

commit;
