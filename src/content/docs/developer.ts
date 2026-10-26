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
- **Stripe** — companies' subscriptions (your account) and customers' fares (each company's own account).
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
- \`NEXT_PUBLIC_VAPID_PUBLIC_KEY\`, \`VAPID_PRIVATE_KEY\` (**secret**), \`VAPID_SUBJECT\` — push notifications (\`npx web-push generate-vapid-keys\`).

Redeploy after changing them. Everything else (Stripe, Resend) is set in the master dashboard.`,
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

- **Create company** — company name, owner's name and email, plan, and start **Active** (billed outside the website) or on a **Free trial**. The owner is emailed a "choose your password" link.
- Open a company to change its **status** (suspend switches everything off at once, data kept), **plan** and **notes**, **re-send the welcome email**, take a **backup**, **restore** one, or **delete** the company (type its name; cannot be undone).
- Each company's addresses: \`/<company>\`, \`/<company>/login\`, \`/<company>/driver\`.`,
      },
      {
        id: "plans",
        title: "Plans",
        body: `**Master → Plans**: name, monthly price, free-trial days, limits (drivers, office users, bookings a month — empty means unlimited), self-service backups, pricing-page feature lines, and whether the plan is public and active.

After changing a price press **Sync to Stripe**: it creates the product and a new monthly price in your Stripe. A plan can only be bought on the website once synced. Existing subscribers keep their old price until moved in Stripe.`,
      },
      {
        id: "requests",
        title: "Requests",
        body: `Setup help and restore requests from companies. Mark them **paid**, **in progress** or **done**. Restores are done from **Companies → the company → Backups**.`,
      },
      {
        id: "audit",
        title: "Audit log",
        body: `Every sensitive action: companies created or changed, keys saved (never the values), restores, plan syncs, subscription changes.`,
      },
    ],
  },
  {
    slug: "platform-stripe",
    title: "Your Stripe (subscriptions)",
    summary: "Take companies' monthly payments into your own Stripe account.",
    audience: "owner",
    sections: [
      {
        id: "keys",
        title: "1. Secret key",
        body: `Stripe → **Developers → API keys → Secret key → Reveal**. Paste it in **Master → Platform settings → Stripe secret key** and **Save keys**.`,
      },
      {
        id: "webhook",
        title: "2. Webhook",
        body: `1. Copy the address shown in Platform settings (\`…/api/platform/stripe-webhook\`).
2. Stripe → **Developers → Webhooks → Add destination**. Scope **Your account**, payload **Snapshot**, API version as shown. Search and tick these six (not "Select all"), then **Continue** → **Webhook endpoint** → **Continue** → paste the address as **Endpoint URL** → **Create destination**:
   - \`checkout.session.completed\`
   - \`customer.subscription.created\`
   - \`customer.subscription.updated\`
   - \`customer.subscription.deleted\`
   - \`invoice.paid\`
   - \`invoice.payment_failed\`
3. Copy the endpoint's **Signing secret** (\`whsec_…\`) into **Webhook signing secret** and save.`,
      },
      {
        id: "portal",
        title: "3. Customer portal",
        body: `Stripe → **Settings → Billing → Customer portal**: switch it on, allow **switching plans** (add your plan products), **invoice history** and **cancellation**, and switch **payment methods OFF** — companies pay each invoice by typing a card in, nothing is kept on file. This is the page companies see when they press **Manage billing**.

Stripe → **Settings → Billing → Subscriptions and emails**:

- **Manage invoices sent to customers**: switch on emailing **finalised invoices** to customers (that email has the Pay button) and the reminders.
- **When an invoice is still unpaid after its due date**: choose **cancel the subscription** (or mark it unpaid) after the number of days you allow.

!> Subscriptions are billed by **invoice** (\`collection_method: send_invoice\`): no card is saved at signup and **Stripe never charges a card automatically**. Each month the company gets an invoice by email, due in 7 days, and pays it on Stripe's page.`,
      },
      {
        id: "plans",
        title: "4. Sync your plans",
        body: `**Master → Plans → Sync to Stripe** on each plan. Then the **Start free trial** buttons on the home page work.`,
      },
      {
        id: "lifecycle",
        title: "What happens automatically",
        body: `- A visitor signs up for a plan with a free trial → the company and its owner login are created straight away (no card asked for) and the welcome email is sent. A plan without a trial: they pay the first invoice first, and the account is made when Stripe confirms it was paid.
- Each month (from the end of the trial) Stripe emails the company an invoice; they pay it on Stripe's page. **No card is saved and nothing is charged automatically.**
- Plan changed in the portal → the company's plan and limits follow.
- Invoice not paid by its due date → company shows "Payment overdue" (still working) and you are emailed.
- Subscription cancelled (by the company, or by Stripe after its retries — set in Stripe → Settings → Billing → Subscriptions and emails) → company is cancelled: switched off, data kept until you delete it.
- You can always suspend or reactivate a company by hand in Master → Companies.`,
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
        body: `- **Vercel → Project → Logs** — server errors (search for \`[checkout]\`, \`[stripe-webhook]\`, \`[platform-webhook]\`, \`[email]\`, \`[backups]\`).
- **Stripe → Developers → Webhooks → an endpoint** — failed deliveries and their responses.
- **Master → Audit log** — what changed and who changed it.`,
      },
      {
        id: "common",
        title: "Common problems",
        body: `- **"Sign-ups are not open yet"** — your Stripe key isn't saved, or the plan isn't synced to Stripe.
- **Paid signup but no account** — you get an email; check the platform webhook's signing secret, then create the company by hand in Master → Companies.
- **Keys can't be saved** — \`SECRETS_ENCRYPTION_KEY\` missing in Vercel (redeploy after adding).
- **No welcome emails** — Resend key or "send from" address missing or not on a verified domain.
- **Address search fails** — Google key restricted to websites, or Places API (New)/Routes API not enabled.`,
      },
    ],
  },
];
