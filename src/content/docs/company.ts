import type { DocPage } from "./types";

/** Getting started and Admin → Settings — for company administrators. */
export const companyPages: DocPage[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    summary: "Your first sign-in, your addresses, and the setup checklist.",
    audience: "company",
    sections: [
      {
        id: "first-sign-in",
        title: "Your first sign-in",
        body: `When your company account is created you get an email titled **"your account is ready"**.

1. Open the email and press **Choose your password**. The button works once and expires after 24 hours.
2. Choose a password of at least 10 characters. You are signed in straight away.
3. You land on your **Admin** dashboard.

> Button expired? Go to the sign-in page, press **Forgot your password?** and enter your email — a new link arrives in a minute.`,
      },
      {
        id: "addresses",
        title: "Your addresses",
        body: `Every company has its own addresses on the platform. Your company id is the short name in the address (for example \`city-cars\`).

- **Booking page:** \`/your-company\` — share this with customers, put it on your website, print it on cards.
- **Staff sign-in:** \`/your-company/login\` — for you and your dispatchers. It shows your logo and colours.
- **Driver sign-in:** \`/your-company/driver\` — for your drivers.

You can always see your exact addresses in **Admin → Settings → Setup checklist**.`,
      },
      {
        id: "checklist",
        title: "The setup checklist",
        body: `**Admin → Settings** starts with a checklist. Work through it once:

1. **Company details** — name, phone, email, address. See [Company details](/documentation/company-details).
2. **Logo and colours** — see [Logo and colours](/documentation/branding).
3. **SMS** — booking confirmations by text. See [SMS](/documentation/sms).
4. **Card payments** — let customers pay by card. See [Card payments with Stripe](/documentation/stripe).
5. **Booking alert emails** — who hears about new bookings. See [Booking alert emails](/documentation/alert-emails).

Then set your prices ([Pricing](/documentation/pricing)), add your drivers ([Drivers](/documentation/drivers)) and you are ready to take bookings.

> Prefer us to do it? **Plan & billing → We'll set it up for you** — see [Setup help](/documentation/setup-help).`,
      },
      {
        id: "roles",
        title: "Who can do what",
        body: `- **Admin** — everything: settings, prices, staff, drivers, billing, backups.
- **Dispatcher** — the dispatch board, bookings, customers, calendar and map. No settings or billing.
- **Driver** — only their own jobs, in the driver app.

Each person signs in with their own email and password. Never share logins.`,
      },
    ],
  },
  {
    slug: "company-details",
    title: "Company details",
    summary: "Your name, contact details, address and time zone.",
    audience: "company",
    sections: [
      {
        id: "fields",
        title: "What each field is for",
        body: `**Admin → Settings → Company details**

- **Company name** — shown on your booking page, apps, emails and texts.
- **Legal name** — the registered name printed on receipts (e.g. "City Cars Ltd"). Leave empty to use the company name.
- **Phone** and **Email** — printed on receipts so customers can contact you.
- **Website** — printed on receipts.
- **Address** — printed on receipts.
- **Time zone** — every time in the system (pickups, reports, night rates) uses it. UK companies: **Europe/London**.

Press **Save** under the card. Changes show everywhere within a minute.`,
      },
    ],
  },
  {
    slug: "branding",
    title: "Logo and colours",
    summary: "Make the booking page, apps, emails and receipts look like your company.",
    audience: "company",
    sections: [
      {
        id: "logo",
        title: "Upload your logo",
        body: `**Admin → Settings → Logo and colours → Upload logo**

1. Use a **PNG, JPG or WebP** file, under **1 MB**. A wide logo on a transparent background looks best.
2. It appears at once on your booking page, staff and driver sign-in, emails and receipts.
3. To remove it, press **Remove**, then **Save**. Without a logo your company name is shown in text.

> SVG files are not accepted, for security.`,
      },
      {
        id: "colours",
        title: "Choose your colours",
        body: `- **Main colour** — buttons, highlights and links.
- **Dark colour** — headers and text.

Pick with the colour box or type a code like \`#1d4ed8\`. The preview buttons show how they look. Press **Save**.

> Choose a main colour dark enough for white text to be readable on it.`,
      },
    ],
  },
  {
    slug: "email",
    title: "Email (Resend)",
    summary: "Send booking emails from your own address, and choose where replies go.",
    audience: "company",
    sections: [
      {
        id: "how-it-works",
        title: "How emails are sent",
        body: `Customers get a confirmation email for each booking and a thank-you after the ride. Your office gets booking alerts.

- **Without your own Resend key** (the default): we send the emails for you. They show **your company name** as the sender and replies go to your office.
- **With your own Resend key:** emails come from **your own address**, e.g. \`bookings@citycars.co.uk\`.

Nothing has to be set for emails to work — your own key is optional.`,
      },
      {
        id: "own-domain",
        title: "Send from your own address (optional)",
        body: `1. Create a free account at **resend.com**.
2. In Resend go to **Domains → Add domain**, enter your domain (e.g. \`citycars.co.uk\`), region **Ireland (eu-west-1)**.
3. Resend shows some DNS records. Add them where your domain is managed (GoDaddy, 123-reg, Cloudflare…). Ask your web person if unsure.
4. Wait until Resend shows the domain as **Verified** (minutes to a few hours).
5. In Resend go to **API Keys → Create API key**, permission **Sending access**. Copy the key — it starts \`re_\`.
6. In **Admin → Settings → Email**: paste the key into **Resend API key**, and type your address into **Send from**, e.g. \`bookings@citycars.co.uk\`. Press **Save**.

!> The **Send from** address must be on the domain you verified, or emails are refused.`,
      },
      {
        id: "replies",
        title: "Customer replies go to",
        body: `Type the inbox that should receive customers' replies, e.g. \`office@citycars.co.uk\`. Several addresses: separate them with commas. Press **Save**.`,
      },
      {
        id: "keys-security",
        title: "How your key is kept safe",
        body: `Your key is encrypted before it is stored, and it is **never shown again** — not to you, not to us. The field then shows "Saved — hidden for security". To change it press **Replace** and paste the new key; the bin icon removes it.`,
      },
    ],
  },
  {
    slug: "sms",
    title: "SMS (Cosmic SMS)",
    summary: "Text customers their confirmation, \"driver arrived\" and \"ride complete\".",
    audience: "company",
    sections: [
      {
        id: "what-is-sent",
        title: "What is texted",
        body: `- **Booking confirmed** — reference, journey, time, price and a tracking link.
- **Driver arrived** — when the driver presses "I've arrived", with the car's colour, make and plate.
- **Ride complete** — with a link to rate the ride.

Texts are sent from **your own** Cosmic SMS account, so you pay Cosmic directly for them.`,
      },
      {
        id: "setup",
        title: "Set it up",
        body: `1. Open an account at **cosmicsms.com** and buy some credit.
2. In Cosmic SMS find your **username** and your **API password** (in the account / API settings — the API password can differ from your login password).
3. In **Admin → Settings → SMS**:
   - **Sender name** — what customers see as the sender. Up to **11 letters or numbers, no spaces** (e.g. \`CityCars\`).
   - **Cosmic username** and **Cosmic API password**.
4. Press **Save**, then make a test booking with your own mobile number.

> UK networks reject sender names longer than 11 characters or with spaces — that is why the box removes them.`,
      },
      {
        id: "troubleshooting",
        title: "No texts arriving?",
        body: `- Check your Cosmic SMS credit.
- Re-enter the username and API password (**Replace**).
- The customer's number must be a mobile number, e.g. \`07700 900123\` or \`+44 7700 900123\`.`,
      },
    ],
  },
  {
    slug: "stripe",
    title: "Card payments with Stripe",
    summary: "Let customers pay by card. The money goes straight into your own Stripe account.",
    audience: "company",
    sections: [
      {
        id: "how-it-works",
        title: "How card payments work",
        body: `- The customer chooses **Card** on your booking page and is taken to **Stripe's own secure payment page** (we never see card numbers).
- Only after Stripe confirms the payment is the booking created — an abandoned payment leaves nothing on your board.
- The money goes into **your** Stripe account and Stripe pays it out to your bank. Stripe charges its own fees.
- The booking shows **Paid by card**, and the payment appears in **Admin → Payments**.

You need two things from Stripe: a **secret key** and a **webhook signing secret**. It takes about 10 minutes.`,
      },
      {
        id: "account",
        title: "1. Create and activate your Stripe account",
        body: `1. Sign up at **stripe.com** with your business email.
2. Complete **Activate payments**: business details, your bank account for payouts, and identity checks. Until this is done you can only use test mode.
3. In the top bar you can switch **Test mode** on and off. Test mode uses pretend money — useful for trying everything first.`,
      },
      {
        id: "secret-key",
        title: "2. Copy your secret key",
        body: `1. In Stripe go to **Developers → API keys**.
2. Under **Standard keys**, next to **Secret key**, press **Reveal** and copy it.
   - Live key starts with \`sk_live_\` — real money.
   - Test key starts with \`sk_test_\` — pretend money (only while Test mode is on).
3. In **Admin → Settings → Card payments (Stripe)**, paste it into **Stripe secret key**.

!> Never email or message your secret key to anyone — including us. Paste it only into your own Settings page.`,
      },
      {
        id: "webhook",
        title: "3. Add the webhook",
        body: `The webhook is how Stripe tells your booking system that a payment went through — even if the customer closes their phone straight after paying.

1. In **Admin → Settings → Card payments**, press **Copy** next to the webhook address. It looks like \`https://…/api/webhooks/stripe/<your id>\`.
2. In Stripe go to **Developers → Webhooks → Add endpoint** (or **Add destination**).
3. Paste the address into **Endpoint URL**.
4. Under **Select events**, tick these seven:
   - \`checkout.session.completed\`
   - \`checkout.session.expired\`
   - \`payment_intent.succeeded\`
   - \`payment_intent.payment_failed\`
   - \`charge.refunded\`
   - \`charge.dispute.created\`
   - \`charge.dispute.closed\`
5. Press **Add endpoint**.
6. On the endpoint's page, under **Signing secret**, press **Reveal** and copy it — it starts \`whsec_\`.
7. Paste it into **Webhook signing secret** in your Settings.

> Test mode and live mode have **separate** keys and webhooks. When you switch to live, repeat steps 2 and 3 in live mode.`,
      },
      {
        id: "switch-on",
        title: "4. Switch card payments on",
        body: `1. Tick **Offer card payment to customers**.
2. Press **Save**. Your keys are encrypted and hidden from then on.
3. Open your booking page — **Card** is now offered next to **Cash**.

Card stays hidden from customers until a secret key is saved, even if the box is ticked.`,
      },
      {
        id: "test",
        title: "5. Test before going live",
        body: `With **test** keys saved, make a booking on your booking page, choose **Card**, and pay with Stripe's test card:

\`\`\`
Card number   4242 4242 4242 4242
Expiry        any future date, e.g. 12/34
CVC           any 3 digits
\`\`\`

You should come back to a **Booking confirmed** page, the job appears on your dispatch board marked paid, and Stripe shows the payment under **Payments**.

Then switch Stripe to live mode, and replace both keys with the **live** ones (and the live webhook's signing secret). Make one small real payment with a different person's card to be sure.`,
      },
      {
        id: "refunds",
        title: "Refunds and disputes",
        body: `- **Refunds** are made in your **Stripe Dashboard → Payments → the payment → Refund**. The booking updates itself to "Refunded" automatically.
- **Disputes / chargebacks**: Stripe emails you and so do we. Respond in the Stripe Dashboard before the deadline it shows.
- Money from Stripe reaches your bank on Stripe's payout schedule (usually a few working days).`,
      },
      {
        id: "troubleshooting",
        title: "Troubleshooting",
        body: `- **Card isn't offered to customers** — check the box is ticked, the secret key is saved, and you pressed Save.
- **"Payment taken but no booking" email** — the payment is in **Admin → Payments** marked for review. Usually the webhook is missing or its signing secret is wrong: check step 3. Create the booking by hand or refund in Stripe.
- **Payments stay "pending"** — the webhook isn't reaching us. In Stripe → Webhooks → your endpoint, look at **failed** deliveries and their error.
- **Changed Stripe accounts?** Replace both the secret key and the webhook signing secret.`,
      },
    ],
  },
  {
    slug: "alert-emails",
    title: "Booking alert emails",
    summary: "Who in your office is emailed about new bookings, reminders and payment problems.",
    audience: "company",
    sections: [
      {
        id: "list",
        title: "Choose who gets alerts",
        body: `**Admin → Settings → Booking alert emails**

1. Type an address and press **Add** (or Enter). Add as many as you like.
2. Remove one with the ✕ next to it.
3. Press **Save**.

These addresses get: every **new booking**, **pickups within the hour** (reminders), and **payment problems**. An empty list means nobody is emailed — the dispatch board still shows everything.`,
      },
    ],
  },
  {
    slug: "booking-widget",
    title: "Booking page and website widget",
    summary: "Share your booking page, or put the booking form on your own website.",
    audience: "company",
    sections: [
      {
        id: "booking-page",
        title: "Your booking page",
        body: `Your booking page is \`/your-company\` on the platform address — see **Admin → Settings → Setup checklist** for the exact link. Share it in texts, emails, on social media or print it as a QR code. Customers can also install it on their phone like an app.`,
      },
      {
        id: "widget",
        title: "Put the booking form on your website",
        body: `**Admin → Widgets**

1. Press **Add Widget**, give it a name (e.g. "Main website").
2. Press **Copy embed code**.
3. Paste the code into your website where the booking form should appear (in WordPress: an "HTML" block; in Wix/Squarespace: an "Embed code" element).

Bookings made through each widget are labelled with its name, so you can see which website they came from.`,
      },
    ],
  },
];
