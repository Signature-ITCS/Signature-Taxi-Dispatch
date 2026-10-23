# Dispatch platform

Taxi and transfer booking, dispatch and driver apps — for many companies at
once. Each company signs up (or is created by the platform owner), gets its own
booking site, dispatch board, driver app, settings, branding and keys, and only
ever sees its own data.

## Who uses what

| Who | Where | What |
|---|---|---|
| Platform owner | `/master` | Companies, plans, subscriptions, requests, platform keys, backups, audit log |
| New company | `/` → `/signup` | Choose a plan, pay on the platform's Stripe, get a "choose your password" email |
| Company admin | `/admin` | Bookings, dispatch, drivers, pricing, **Settings** (logo, colours, Stripe, Resend, SMS), **Backups**, Plan & billing (`/account`) |
| Dispatcher | `/dispatch` | Dispatch board, bookings, calendar, map |
| Driver | `/driver` | Driver app with push notifications |
| Customer | `/book/<company>` | Booking widget, card or cash; `/track/<ref>` live tracking |

## How companies are kept apart

- One Supabase database. Every company-owned table has `company_id`.
- **Row-level security** on every table: a signed-in user only ever reads or
  changes rows of their own company, and nothing while it is suspended.
- A trigger stamps `company_id` on every new row and refuses any row that
  points at another company's row (driver, customer, car class…).
- Server code that needs the service role uses `tenantDb(companyId)`
  (`src/lib/tenantDb.ts`), which filters every query to one company. The
  company always comes from the signed-in user or the booking website — never
  from the browser.
- Plan limits (drivers, office users, bookings a month) are enforced in the
  database.
- Company API keys are encrypted (AES-256-GCM, `SECRETS_ENCRYPTION_KEY`) and
  write-only: screens only ever show "saved ••••1234".

`db/2026-10-24_platform.sql` holds all of this; the tests that prove it are
described in `db/README.md`.

## Setting up

1. Supabase: run `db/platform_setup.sql` on a new, empty project. Create your
   own login (Authentication → Users), then run
   `select platform_add_owner('you@example.com');`
2. Vercel: set the variables in `.env.example`, deploy.
3. Sign in at `/login` → you land on `/master`. In **Platform settings** add your
   Stripe and Resend keys and the Stripe webhook; in **Plans** press
   "Sync to Stripe" on each plan.
4. Whole-database backups: see `ops/backup-repo/README.md` (a separate,
   private repository).

## Develop

```bash
npm install
npm run dev
```

Next.js 16 — see `AGENTS.md`. Middleware is `src/proxy.ts`.
