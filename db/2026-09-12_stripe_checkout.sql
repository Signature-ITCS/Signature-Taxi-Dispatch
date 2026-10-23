-- Stripe Checkout: hosted payment page (2026-09-12)
--
-- The customer now leaves the site to pay on checkout.stripe.com, and the
-- booking is only written once Stripe confirms the money. That means the trip
-- details have to survive the round trip WITHOUT being a booking yet — otherwise
-- every abandoned checkout would leave junk on the dispatch board.
--
-- This table is that waiting room. A draft becomes a real booking exactly once:
-- whichever arrives first — the customer returning, or the webhook — creates it,
-- and `booking_id` makes the second one a no-op.
begin;

create table if not exists public.checkout_drafts (
  id                uuid primary key default gen_random_uuid(),
  -- Stripe Checkout Session. Unique = one session can only ever make one booking.
  session_id        text unique not null,
  payment_intent_id text,
  -- The whole validated booking request, replayed into create_booking on return.
  payload           jsonb       not null,
  -- Amount we priced server-side and asked Stripe to charge, in pounds.
  amount            numeric     not null,
  currency          text        not null default 'gbp',
  website_slug      text,
  -- Fingerprint of the priced trip: lets a customer who presses Pay again land
  -- back on the SAME Stripe session instead of opening a second one.
  quote_sig         text,
  -- open → completed (booking made) | expired (customer never paid)
  status            text        not null default 'open',
  booking_id        uuid references public.bookings(id) on delete set null,
  booking_number    text,
  customer_email    text,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  expires_at        timestamptz not null default (now() + interval '30 minutes')
);

comment on table public.checkout_drafts is
  'Booking requests parked while the customer pays on Stripe Checkout. Not bookings — nothing here is dispatched. Cleared by expiry.';
comment on column public.checkout_drafts.booking_id is
  'Set the moment the draft becomes a real booking. Non-null = already redeemed; both the return page and the webhook check this first.';

create index if not exists checkout_drafts_status_idx on public.checkout_drafts (status, created_at desc);
create index if not exists checkout_drafts_pi_idx     on public.checkout_drafts (payment_intent_id);
create index if not exists checkout_drafts_reuse_idx  on public.checkout_drafts (quote_sig, status) where status = 'open';

-- Service role only. The customer's own draft is read back through our API by
-- its unguessable id; nothing here is ever exposed to anon/authenticated.
alter table public.checkout_drafts enable row level security;

commit;
