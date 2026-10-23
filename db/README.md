# Database

## Standing up the platform (new, empty Supabase project)

Run **`platform_setup.sql`** once (SQL Editor → New query → paste → Run). It is
every file below joined in the right order, ending with
`2026-10-24_platform.sql`, which turns the single-company schema into the
multi-company platform. It refuses to run on a database that already has
bookings or staff.

Then create your own login (Authentication → Users → Add user, auto-confirm)
and make it the platform owner:

```sql
select platform_add_owner('you@example.com');
```

Companies are created from the master dashboard or by signing up — each gets
its starting data from `seed_company()`; never insert company rows by hand.

`platform_setup.sql` is generated — edit the dated files and rebuild it
(the order is listed at its top).

### What 2026-10-24_platform.sql does

- Platform tables: `plans`, `companies`, `platform_admins`, `platform_settings`,
  `secrets` (encrypted by the app), `setup_requests`, `restore_requests`,
  `company_backups`, `platform_audit`.
- `company_id` (required) on all 22 company tables; uniqueness per company
  (customers by phone, settings by key, Stripe ids).
- `tenant_guard` trigger: fills `company_id` and blocks cross-company references.
- Row-level security rebuilt: own company only, nothing while suspended.
- Pricing/booking functions scoped to the website's company; staff functions
  run as the signed-in user.
- Plan limits enforced by trigger (`enforce_plan_limits`).
- `restore_company(company, backup)`: puts one company back, in one transaction.

It was tested on PGlite (real Postgres) with two rival companies: isolation for
staff, drivers and the public; plan limits; suspension; backup and restore of
one company leaving the other untouched; running the file twice.

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

- `platform_setup.sql` — the whole database in one file (generated).
- Whole-database backups (all companies): `ops/backup-repo/README.md` — keep them in a separate private repository.
