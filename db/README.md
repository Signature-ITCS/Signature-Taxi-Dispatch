# Database

## Standing up a NEW instance

On a brand-new, empty Supabase project, run these in the SQL editor **in order**:

1. `00_schema.sql` — types, tables, keys, indexes, helper and trigger functions
2. `01_functions.sql` — pricing, booking, tracking, cash, reporting; triggers; row-level security
3. `2026-09-15_external_bookings.sql` — adds `create_external_booking()`
4. `02_seed.sql` — car classes, distance bands, surcharges, default settings

That's it. `00` and `01` are a full snapshot of the database as it stood on
2026-09-23, so the other dated files below are already folded into them — you do
not need to run them on a fresh project (they are idempotent, so running them
does no harm either).

Then two things `02_seed.sql` deliberately leaves out, because they belong to
whoever runs this particular instance:

- **The first admin.** Sign the user up through Supabase Auth, then
  `insert into profiles (id, full_name, email, role) values ('<auth user id>', 'Admin', 'you@example.com', 'admin');`
- **A website row.** `insert into websites (name, slug) values ('Main Website', 'main');`
  then read back its generated `api_key` and put it in `WIDGET_API_KEY`.

Car classes, pricing and settings all arrive with the seed, so the widget can
quote a fare as soon as those two rows exist.

## Why 00_schema.sql exists

The repo only ever carried incremental changes, so the actual shape of the
database lived nowhere but inside one Supabase project. Spinning up a second
instance was impossible from the repo alone. These two files fix that.

Regenerate them if the schema drifts a long way from what is here.

## Dated migrations

Applied to the original project in this order. Kept for history; already
included in `00`/`01` except where noted.

| File | What it did |
|---|---|
| `2026-09-05_pricing_base_plus_bands.sql` | Base fare + tapered distance bands; dropped per-minute and minimum fare |
| `2026-09-12_stripe_hardening.sql` | `payments` review columns, unique index on `stripe_payment_intent_id`, `stripe_events` |
| `2026-09-12_external_driver.sql` | Hand one ride to an outside driver, with their car |
| `2026-09-12_stripe_checkout.sql` | `checkout_drafts` — trips parked while the customer pays on Stripe |
| `2026-09-15_external_bookings.sql` | Off-platform bookings — **also defines `create_external_booking()`, so run this one** |
| `2026-09-28_distance_bands_add_up.sql` | "Add up distance bands" switch in Admin → Pricing. Already in `01`/`02` for new instances; **run it on every instance created before 2026-09-28** |
| `2026-10-09_job_status.sql` | Manual job status on bookings (processing, on hold, completed, cancelled, refunded). Already in `00` for new instances; **run it on every instance created before 2026-10-09** |
| `2026-10-13_ride_thank_you.sql` | Thank-you email when a ride is completed: `bookings.thanks_sent_at`, the `notify_booking_completed` trigger (pg_net) and its webhook URL; also fixes the company name and SMS sender. Trigger and column are in `00`/`01`; **run this file on every instance** — the webhook URL is per-instance |
| `2026-10-13_driver_app.sql` | Driver app: driver read access to their own jobs, `driver_*` functions (online/offline, location, job steps), automatic busy status, `driver_locations`, `push_subscriptions`, customer SMS on arrival/completion and driver push on assignment (`notify_booking_change`), realtime for bookings and drivers. **Not yet folded into `00`/`01` — run it on every instance, after `2026-10-13_ride_thank_you.sql`** |
| `2026-10-15_reminders.sql` | One-hour pickup reminders: `bookings.reminder_sent_at`, pg_cron job `booking-reminders` (every 5 min) calling `/api/cron/reminders`. **Run it on every instance, after `2026-10-13_driver_app.sql`** |
| `2026-10-15_scheduled_jobs.sql` | Accepting a pre-booked job no longer makes the driver busy until an hour before pickup; the 5-minute scheduler turns them busy on time. **Run after `2026-10-15_reminders.sql`** |
| `2026-10-15_notifications.sql` | Staff notification bell: `staff_notifications` (written by a bookings trigger for new/assigned/accepted/declined/arrived/picked up/completed/cancelled/paid, plus reminders), `profiles.notifications_seen_at`, realtime, 30-day clean-up. **Run after `2026-10-15_scheduled_jobs.sql`** |
| `2026-10-19_fixed_prices.sql` | Fixed prices between areas drawn on the map (`pricing_zones`, `fixed_routes`, `point_in_zone`, `find_fixed_route`), stops add their extra miles at the per-mile rate, and every fare is rounded to the nearest pound. Replaces `estimate_fare`, `quote_fares` and `create_booking` (new optional arguments). **Run after `2026-10-15_notifications.sql`** — the app works before and after it |
| `2026-10-22_route_night_rate.sql` | Per fixed route tick "Night rate / time-based charges apply" (`fixed_routes.time_charges`, default off): ticked routes get only time-window extra charges (e.g. +20% 23:00–06:00) on top of the fixed price. **Run after `2026-10-19_fixed_prices.sql`** — the app works before and after it |
| `2026-10-23_charge_exclusions.sql` | Extra charges can skip journeys whose addresses contain given words (`pricing_rules.exclude_keywords`). Sets the night rate (time-window charges) to skip "airport, heathrow, gatwick, stansted". **Run after `2026-10-22_route_night_rate.sql`** — the app works before and after it |

`2026-10-09_sumup.sql` from the white-label kit is deliberately **not** here: this
instance keeps Stripe, so the Stripe column names (`stripe_payment_intent_id`,
`checkout_drafts.payment_intent_id`) and `stripe_events` stay as they are.
Unlike the kit, `00`/`01` here are NOT updated with the October changes —
on a brand-new instance run `00`, `01`, `2026-09-15_external_bookings.sql`,
`02`, `2026-09-28_distance_bands_add_up.sql` and then every `2026-10-*` file
above, in order.

## Other files

- `reset_demo_data.sql` — clears test bookings, customers and payments before go-live.
- `BACKUPS.md` — nightly backups and one-click restore (GitHub Actions).
