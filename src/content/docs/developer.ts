import type { DocPage } from "./types";

/** Platform owner / developer documentation. Only shown to the signed-in platform owner. */
export const developerPages: DocPage[] = [
  {
    slug: "platform-overview",
    title: "Platform overview and security",
    summary: "How the platform is built and how companies are kept apart.",
    audience: "owner",
    sections: [
      {
        id: "stack",
        title: "What it runs on",
        body: `- **Next.js 16** app on **Vercel** (middleware is \`src/proxy.ts\`).
- **Supabase** (Postgres, Auth, Storage, Realtime) — one project for all companies.
- **Stripe** — customers' fares, into each company's own account. Companies' subscriptions are billed by hand with payment links (Master → Billing).
- **Resend** — email. **Cosmic SMS** — text messages. **Google Maps** — address search and routes (your key).
- Repository: \`Signature-ITCS/Signature-Texi-Dispatch\`, \`main\` deploys automatically.`,
      },
      {
        id: "isolation",
        title: "How companies are kept apart",
        body: `- Every company-owned table has \`company_id\`.
- **Row-level security** on every table: signed-in users only see rows of their own company — and nothing while the company is suspended.
- The \`tenant_guard\` trigger stamps \`company_id\` on new rows and refuses any row pointing at another company's row.
- Server code using the service role goes through \`tenantDb(companyId)\` (\`src/lib/tenantDb.ts\`), which filters every query to one company. The company always comes from the signed-in user or the booking website, never the browser.
- Plan limits are enforced in the database (\`enforce_plan_limits\`).`,
      },
      {
        id: "secrets",
        title: "How keys are protected",
        body: `- Companies' and your own API keys are encrypted with **AES-256-GCM** before they are stored (\`src/lib/crypto.ts\`), using \`SECRETS_ENCRYPTION_KEY\` from Vercel.
- The \`secrets\` table has no access rules for any user: only the server reads it, at the moment of use.
- No key, or part of one, is ever sent to a browser. Screens only know a key is saved, and when.
- Changes are logged (which key, who, when) — never the value.
- **Two-factor sign-in** (authenticator app) is **required** for your master login: a password alone gets nothing in the master dashboard. Set it up at **/security** the first time you sign in. Lost phone: remove your factor in **Supabase → Authentication → Users → you → MFA**, then set up a new one. Every company admin and dispatcher must set it up within 3 days of their login being created (for sign-ups, from your approval) — prompted at each sign-in, blocked after; company admins can require it straight away; you can reset a company user's in **Master → Companies → the company → Lost phone**.

!> Keep \`SECRETS_ENCRYPTION_KEY\` in a password manager and **never change it** once keys are saved — every saved key would have to be re-entered. Turn on two-factor sign-in on Vercel, Supabase, GitHub, Stripe and Resend.`,
      },
    ],
  },
  {
    slug: "platform-setup",
    title: "Setting up the platform",
    summary: "Supabase SQL, Vercel environment variables and your owner login.",
    audience: "owner",
    sections: [
      {
        id: "database",
        title: "Database (Supabase)",
        body: `On a new, empty Supabase project, in **SQL Editor**, run in order (paste the whole file each time):

1. \`1a_base_tables.sql\`
2. \`1b_features.sql\`
3. \`1c_multi_company.sql\`

They are generated from \`db/\` in the repository (\`db/platform_setup.sql\` is all three in one). Then **Authentication → URL Configuration → Site URL** = your platform address.`,
      },
      {
        id: "owner",
        title: "Your owner login",
        body: `1. **Authentication → Users → Add user**: your email, a strong password, tick **Auto Confirm User**.
2. In the SQL Editor:

\`\`\`
select platform_add_owner('you@example.com');
\`\`\`

Signing in at \`/login\` then takes you to \`/master\`.`,
      },
      {
        id: "env",
        title: "Vercel environment variables",
        body: `**Vercel → Project → Settings → Environment Variables** (mark secrets **Sensitive**):

- \`NEXT_PUBLIC_SUPABASE_URL\`, \`NEXT_PUBLIC_SUPABASE_ANON_KEY\` — Supabase → Project Settings → API.
- \`SUPABASE_SERVICE_ROLE_KEY\` — **secret**, bypasses all security; server only.
- \`SECRETS_ENCRYPTION_KEY\` — **secret**, 32 random bytes in base64.
- \`NEXT_PUBLIC_SITE_URL\` — your platform address, e.g. \`https://booking.airport-transfer.uk\`.
- \`GOOGLE_MAPS_API_KEY\` — **secret**; enable **Places API (New)** and **Routes API**; restrict by API, not by website; set a daily quota and a budget alert.
- \`CRON_SECRET\` — **secret**, any long random string (daily job).
- \`NEXT_PUBLIC_TURNSTILE_SITE_KEY\` and \`TURNSTILE_SECRET_KEY\` (**secret**) — optional Cloudflare Turnstile "are you human?" check on sign-up, sign-in, forgot password and partner applications (Cloudflare → Turnstile → Add widget). For sign-in, also switch on **Supabase → Authentication → Attack Protection → CAPTCHA** with the same secret.
- \`NEXT_PUBLIC_VAPID_PUBLIC_KEY\`, \`VAPID_PRIVATE_KEY\` (**secret**), \`VAPID_SUBJECT\` — push notifications (\`npx web-push generate-vapid-keys\`).

Redeploy after changing them. Everything else (your Resend key) is set in the master dashboard.`,
      },
    ],
  },
  {
    slug: "master-dashboard",
    title: "Master dashboard",
    summary: "Companies, plans, requests, platform settings and the audit log.",
    audience: "owner",
    sections: [
      {
        id: "companies",
        title: "Companies",
        body: `**Master → Companies**

- **New sign-ups wait for you**: they show as **pending approval** at the top (you are also emailed). Nothing works for them and they get no email until you open the company and press **Approve** — that starts their free trial (if the plan has one, otherwise their first invoice goes to Billing) and emails them a link to choose their password. **Reject** deletes the sign-up.
- **Create company** — company name, owner's name and email, plan, and start **Active** (billed outside the website) or on a **Free trial**. The owner is emailed a "choose your password" link.
- Open a company to change its **status** (suspend switches everything off at once, data kept), **plan** and **notes**, **re-send the welcome email**, take a **backup**, **restore** one, or **delete** the company (type its name; cannot be undone).
- Each company's addresses: \`/<company>\`, \`/<company>/login\`, \`/<company>/driver\`.`,
      },
      {
        id: "plans",
        title: "Plans",
        body: `**Master → Plans**: name, monthly price, free-trial days, limits (drivers, office users, bookings a month — empty means unlimited), self-service backups, pricing-page feature lines, and whether the plan is public and active.

A new price applies to invoices made from then on; invoices already made keep their amount (you can edit an unpaid one in **Billing**).`,
      },
      {
        id: "billing",
        title: "Billing",
        body: `**Master → Billing**: **To send**, **Waiting for payment**, **Overdue** and **Paid** invoices, with totals for each. Open an invoice to write the email or WhatsApp, mark it sent, and mark it paid. Full guide: [Billing companies](/documentation/platform-billing).`,
      },
      {
        id: "partners",
        title: "Partners",
        body: `**Master → Partners**: independent drivers and operators apply at **/partners/join** (share that link yourself; it isn't on the home page or in search engines). Check their licences, then **Approve** — they get an email to set a password and sign in at /login to their own page (an **Available now** switch). Press **+1 month paid** when they pay; they're listed only while approved, paid up and with licences in date, and hidden automatically otherwise. **Disable** removes them at once. Reports from companies appear at the top. Set the monthly price shown on the join page at the top right.`,
      },
      {
        id: "requests",
        title: "Requests",
        body: `Setup help and restore requests from companies. Mark them **paid**, **in progress** or **done**. Restores are done from **Companies → the company → Backups**.`,
      },
      {
        id: "audit",
        title: "Audit log",
        body: `Every sensitive action: companies created or changed, keys saved (never the values), restores, invoices sent and paid.`,
      },
    ],
  },
  {
    slug: "platform-billing",
    title: "Billing companies (payment links)",
    summary: "Companies' monthly subscriptions, billed by hand: send a payment link, mark it sent, mark it paid.",
    audience: "owner",
    sections: [
      {
        id: "how",
        title: "How it works",
        body: `The platform takes **no payments itself** and never stores or charges a card. It keeps a list of invoices instead:

1. **A week before** a company's billing date, its next invoice appears in **Master → Billing → To send** (plan, period, amount, due date). You also get a daily email listing what to send.
2. You send them a **payment link** however you like — a Stripe Payment Link, a bank-transfer request, anything — by **email** or **WhatsApp**. On the invoice, **Write email** / **Write WhatsApp** open a ready-written message to the owner (paste the link first so it is included).
3. Press **Mark sent (email)** or **Mark sent (WhatsApp)**. It moves to **Waiting for payment**, so you never send it twice.
4. When the money arrives, set the date, add a note (e.g. the payment reference) and press **Mark paid**. The company is then paid up until the end of that period, and the next invoice appears a week before that.

The billing date is: the end of the free trial for a new trial company, else the day it was created (no trial), then the end of each paid month.`,
      },
      {
        id: "overdue",
        title: "Overdue and unpaid",
        body: `- An invoice not paid by its due date shows **Overdue**, and the company shows **Payment overdue** — it **keeps working**.
- The company's admin sees it under **Plan & billing → Invoices** (with a **Pay now** button if you saved the payment link on the invoice).
- Switching a company off is **your** decision: **Master → Companies → the company → Status → suspended**. Marking its invoice paid later makes it **Active** again.`,
      },
      {
        id: "changes",
        title: "Changing amounts, cancelling, free months",
        body: `- **Amount**: change it on the invoice before it is paid (e.g. a discount). New invoices use the plan's price at the time they are made.
- **Plan change**: change the plan in **Master → Companies**; the next invoice uses the new plan.
- **Cancel invoice**: removes it, and a fresh one for the same period is made at the plan's current price (use it after changing plan).
- **Free month**: mark the invoice paid with a note such as "free month".
- **Never bill a company** (free, or billed another way): tick **Don't make invoices for this company** on it.
- **Mistakes**: **Not sent after all** and **Undo paid** put an invoice back.`,
      },
      {
        id: "phone",
        title: "Owners' WhatsApp numbers",
        body: `The sign-up form asks for a mobile / WhatsApp number. For companies you create yourself, or to correct it, edit **Owner's mobile / WhatsApp** in **Master → Companies → the company**.`,
      },
    ],
  },
  {
    slug: "platform-email",
    title: "Your Resend (platform emails)",
    summary: "Welcome, password and notice emails — and companies' emails until they add their own.",
    audience: "owner",
    sections: [
      {
        id: "setup",
        title: "Set it up",
        body: `1. resend.com → **Domains → Add domain** (region Ireland), add the DNS records, wait for **Verified**.
2. **API Keys → Create API key** (Sending access), copy it (\`re_…\`).
3. **Master → Platform settings**: paste the key, set **Send platform emails from** to an address on that domain, and your **support email** (where signups and requests are reported). Save.`,
      },
    ],
  },
  {
    slug: "platform-backups",
    title: "Backups (platform)",
    summary: "Per-company nightly backups, and whole-database backups.",
    audience: "owner",
    sections: [
      {
        id: "per-company",
        title: "Per-company backups",
        body: `Every night (Vercel cron, 04:00 UTC) each company is exported to **Supabase Storage → company-backups/<company id>/<date>.json**, kept 30 days. Restoring puts back only that company, in one database transaction, after taking a fresh backup first.`,
      },
      {
        id: "whole-database",
        title: "Whole-database backups (off-site)",
        body: `\`ops/backup-repo/\` in the repository holds GitHub Actions workflows that dump the whole database every night and restore it in one click.

!> Put them in a **separate, private** GitHub repository — never the public app repository. Add the secret \`SUPABASE_DB_URL\` (Supabase → Connect → Session pooler, with the database password).`,
      },
    ],
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    summary: "Common problems and where to look.",
    audience: "owner",
    sections: [
      {
        id: "logs",
        title: "Where to look",
        body: `- **Vercel → Project → Logs** — server errors (search for \`[checkout]\`, \`[stripe-webhook]\` (companies' card payments), \`[email]\`, \`[backups]\`, \`[keepalive]\`).
- **Master → Audit log** — what changed and who changed it.`,
      },
      {
        id: "common",
        title: "Common problems",
        body: `- **A company has no invoice in Billing** — its billing date is more than a week away, billing is paused for it, its plan costs £0, or it is suspended or cancelled.
- **Keys can't be saved** — \`SECRETS_ENCRYPTION_KEY\` missing in Vercel (redeploy after adding).
- **No welcome emails** — Resend key or "send from" address missing or not on a verified domain.
- **Address search fails** — Google key restricted to websites, or Places API (New)/Routes API not enabled.`,
      },
    ],
  },
];
