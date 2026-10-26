# Whole-database backups (all companies)

> **Put these files in a SEPARATE, PRIVATE GitHub repository — not in the app
> repository.** The app repo has to stay public for Vercel Hobby, and these
> backups contain every company's customers, payments and logins. Copy the
> `.github` folder and this README into a new private repo (e.g.
> `Signature-ITCS/platform-backups`) and set the secret there.
>
> This is the platform-level safety net. Each company also gets its own nightly
> backup inside the app (Admin → Backups / master dashboard → Companies), which
> is what a single company's restore uses.

> **The GitHub repository must be PRIVATE before backups are switched on.**
> Backups contain customers' names and phone numbers and staff/driver logins.
> On a public repository any GitHub user could download them.
> GitHub → repo → Settings → General → Danger Zone → Change visibility → Private.
> Also turn on two-factor sign-in for the GitHub account.

Every night at 02:30 (UK time is 02:30 in winter, 03:30 in summer) GitHub makes
two files:

- **`platform-db-<date>.sql.gz`** — the complete database: all app data
  (bookings, customers, drivers, payments, pricing, settings, logs), every
  table, function, trigger and security rule, and staff/driver logins;
- **`companies-<date>.tar.gz`** — one JSON file per company (`<slug>.json`),
  for putting back a single company without touching the others.

Where they are kept:

| Place | How long | Set-up |
|---|---|---|
| GitHub **Releases** (private), `backup-<date>` | **365 days** | the one secret below |
| GitHub (Actions → "Back up database" → a run → **Artifacts**) | 30 days | the one secret below |
| Google Drive, folder **Dispatch Platform Backups** | 365 days | optional, see step 4 |

Restores (Actions → Run workflow):

| Workflow | What it puts back |
|---|---|
| **Restore one company** | one company, from any night in the last year — everyone else untouched |
| **Restore database** | the whole database, every company — for a crashed or wiped database |

## 1. Turn it on (once)

1. **Supabase** → your project → **Connect** (top bar) → **Session pooler**.
   Copy the connection string and replace `[YOUR-PASSWORD]` with the database
   password (Project Settings → Database → reset it there if you don't have it).
   It looks like
   `postgresql://postgres.<project-ref>:PASSWORD@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`
2. **GitHub** → your PRIVATE backups repo → **Settings → Secrets and variables →
   Actions → New repository secret**
   - Name: `SUPABASE_DB_URL`
   - Value: the connection string from step 1
3. **Test it:** **Actions → Back up database → Run workflow**. After a minute or
   two the run turns green and shows a `db-backup` artifact you can download.

## 2. Restore ONE company (others untouched)

**Actions → Restore one company → Run workflow**

- *Company*: its address name (slug) — e.g. `skyline` for `booking.airport-transfer.uk/skyline`
- *Backup date*: `latest`, or a date like `2026-10-14` (any night in the last year)
- *Confirm*: type the address name again

It first saves the company as it is now (attached to that run, so the restore
can be undone), then puts back all of that company's bookings, customers,
drivers, cars, prices, settings and history in one transaction — no texts or
emails are sent, and no other company is touched. If the company had been
deleted, its company row is put back too; its logins are not, so re-send the
welcome email from Master → Companies and re-invite drivers.

Anything that company booked after that backup is lost.

## 3. Restore the WHOLE database

### Option A — paste into Supabase (no tools needed)

1. GitHub → **Releases** → `backup-<date>` → download `platform-db-<date>.sql.gz`
   (or, for the last 30 days, **Actions → Back up database** → that night's run
   → **Artifacts → db-backup**) and unzip it, e.g. with 7-Zip, to get the `.sql` file.
2. Open the `.sql` file in a text editor, select all, copy.
3. **Supabase → SQL Editor → New query** → paste → **Run**.

That replaces every app table and its data with the backup and adds back any
missing logins (existing logins are left alone). Very large backups can be slow
to paste in the browser — then use option B.

### Option B — one click from GitHub

**Actions → Restore database → Run workflow**

- *Backup date*: `latest`, or a date like `2026-10-14`
- *Confirm*: type `RESTORE`

→ **Run workflow**. It replaces all app tables and data with that backup, adds
back any missing logins, and switches live updates back on. Anything booked
after that backup is lost, so use it for a crashed, wiped or new database.

**Moving to a new Supabase project:** create the project, run nothing in it,
change the `SUPABASE_DB_URL` secret to the **new** project's Session pooler
string, then run the restore. Afterwards update `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel and
redeploy.

**Practise once.** Before you ever need it, restore into a spare free Supabase
project (change the secret, restore, check the data, change the secret back).
A backup you have restored once is one you can trust.

### Restoring by hand (without GitHub)

With the PostgreSQL client installed (`psql`), from the folder with the file:

```
gunzip platform-db-2026-10-14.sql.gz
psql "SESSION_POOLER_CONNECTION_STRING" -v ON_ERROR_STOP=1 --single-transaction -f platform-db-2026-10-14.sql
```

(Logins that already exist are skipped automatically.)

## 4. Also keep a copy in Google Drive (optional)

GitHub keeps a year. To have a copy in your own Google Drive as well:

1. On a computer, install **rclone** (https://rclone.org/downloads/).
2. Run `rclone config` → `n` (new remote) → name **`gdrive`** → storage
   **drive** (Google Drive) → leave client id/secret blank → scope **1** (full
   access) → accept the defaults → let it open the browser and sign in with the
   Google account that should hold the backups.
3. Turn the config into one line of text:
   - Windows (PowerShell):
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:APPDATA\rclone\rclone.conf"))`
   - Mac/Linux: `base64 -w0 ~/.config/rclone/rclone.conf`
4. GitHub → Settings → Secrets → Actions → New secret **`RCLONE_CONFIG`** →
   paste that text.

From the next night on, each backup is also copied to **Dispatch Platform Backups**
in that Drive, and copies older than 365 days are removed.

The `.sql` files contain customer names, phone numbers and logins (password
hashes, not passwords). Keep the Drive folder private.
