import type { DocPage } from "./types";

/** Pricing, team, plan and backups — for company administrators. */
export const operationsPages: DocPage[] = [
  {
    slug: "pricing",
    title: "Pricing",
    summary: "Car types, base fares, distance bands, extra charges and child seats.",
    audience: "company",
    sections: [
      {
        id: "how-prices-work",
        title: "How a price is worked out",
        body: `For a normal journey:

**price = base fare + distance price + extra charges**, rounded to the nearest pound.

- The **distance** is measured on the road by Google, in miles, from pickup to drop-off (including any stops).
- A journey between two areas you have drawn can have a **fixed price** instead — see [Fixed prices](/documentation/fixed-prices).
- Customers see the price before they book, and the booking is saved at exactly that price.

Use the **Price calculator** on the Pricing page to check a price for any distance.`,
      },
      {
        id: "car-types",
        title: "Car types",
        body: `**Admin → Pricing** lists your car types (Saloon, Estate, Executive, MPV, 8 Seater to start with).

- **Base fare** — added to every journey in that car.
- **Passengers, Suitcases, Hand bags** — what the car carries; customers can't choose more than this.
- **Enabled / Disabled** — switch off a car type you don't run. At least one must stay on.`,
      },
      {
        id: "distance-bands",
        title: "Distance bands",
        body: `Each car type has bands like "0–2 mi at £10 a mile, 2–5 mi at £6…".

Choose how bands are charged with the switch at the top:

- **Add up (tapered)** — each band charges only the miles inside it, like tax bands. A 15-mile trip pays the first band's rate for its first miles, the next band's for the next miles, and so on. Long trips get cheaper per mile.
- **Whole trip at one rate** — the whole distance is charged at the rate of the band the trip ends in.

Add a band with **+**, remove it with **Remove band**. The last band should reach a large number (e.g. 1000 mi) so long trips are always priced.`,
      },
      {
        id: "extra-charges",
        title: "Extra charges (airport, night rate…)",
        body: `**Admin → Pricing → Extra charges → Add charge**

1. **Name** — what the customer sees, e.g. "Airport".
2. **Fixed £** or **Percentage %**.
3. **When does it apply?**
   - **When the address contains a word** — e.g. \`airport\`: added when the pickup, a stop or the drop-off contains that word.
   - **Between two times (e.g. night rate)** — by **pickup time**, in your time zone. It can run past midnight, e.g. 23:00 → 06:00.
   - **Every journey**.
4. **Don't apply when the address contains** — words that cancel the charge, e.g. \`airport, heathrow, gatwick\` so the night rate is not added to airport runs. Edit it later with the ✏️.
5. Save. Switch a charge off or on at any time.`,
      },
      {
        id: "child-seat",
        title: "Child seat",
        body: `**Child seat** — the price added when a customer asks for one. It is charged once per trip (on the outbound leg of a return).`,
      },
    ],
  },
  {
    slug: "fixed-prices",
    title: "Fixed prices between areas",
    summary: "Set one price for journeys between two areas you draw on the map — like airport runs.",
    audience: "company",
    sections: [
      {
        id: "areas",
        title: "1. Draw your areas",
        body: `**Admin → Pricing → Fixed prices → Areas**

1. Press to add an area and give it a name (e.g. "Town centre", "Heathrow").
2. **Click on the map** to place the corners around it. At least 3 points.
3. Save.

Draw areas generously — a pickup just outside an area won't match.`,
      },
      {
        id: "routes",
        title: "2. Add fixed routes",
        body: `**Fixed routes → add**

1. Choose the **From area** and **To area**.
2. Enter a **price per car type**. Leave a car type empty to price it normally on that route.
3. Tick **Both ways** if the same price applies in reverse.
4. Tick **Night rate / time-based charges apply** if night-time charges should be added on top of this route's price (only charges with times are added, never keyword or "every journey" charges). The route then shows 🌙.
5. Save.

Stops on the way add their extra miles at the car's normal per-mile rate.`,
      },
      {
        id: "test",
        title: "3. Check it",
        body: `Use **Test a journey**: pick two places. It shows **"Fixed: A → B"** with the fixed price, or **"Per-mile pricing"** when no route matches.

An option at the top decides whether your other extra charges are also added on top of fixed prices (off by default).`,
      },
    ],
  },
  {
    slug: "dispatchers",
    title: "Office users (dispatchers and admins)",
    summary: "Give your office staff their own logins.",
    audience: "company",
    sections: [
      {
        id: "add",
        title: "Add a dispatcher",
        body: `**Admin → Dispatchers → Add Dispatcher**

1. Enter their **name**, **email**, a starting **password** and choose **Dispatcher** (or **Admin** for full access).
2. They are emailed their login details, the staff sign-in address \`/your-company/login\` and an "Install the app" link.

Your plan decides how many office users you can have. At the limit you'll see "Your plan's office-user limit is reached" — upgrade on **Plan & billing**.`,
      },
      {
        id: "remove",
        title: "Remove a dispatcher",
        body: `Press the bin next to them and confirm. Their login stops working at once; bookings they handled are kept.`,
      },
    ],
  },
  {
    slug: "drivers",
    title: "Drivers",
    summary: "Add drivers and their cars, and give them the driver app.",
    audience: "company",
    sections: [
      {
        id: "add",
        title: "Add a driver",
        body: `**Admin → Drivers → Add**

- **Name**, **WhatsApp / phone** and **service area** are required.
- Add their **car**: make, model, colour, plate and car type — customers see this when the driver arrives.
- **Active / Pending / Blocked** — only active drivers can be given jobs.

Your plan decides how many drivers you can have. At the limit you'll see "Your plan's driver limit is reached".`,
      },
      {
        id: "app-login",
        title: "Give a driver the app",
        body: `1. Edit the driver and tick **Give this driver the driver app**.
2. Enter their **email** and a **password** (8+ characters). Save.
3. They get an email with their login and an install link. Their sign-in page is \`/your-company/driver\`.

They should install it on their phone and **allow notifications** — that is how new jobs reach them. See [Driver app](/documentation/driver-app).`,
      },
      {
        id: "cash",
        title: "Cash from drivers",
        body: `Cash jobs completed by a driver are counted under their name. When a driver hands the cash in, record it as settled — the driver sees their own cash totals in the app.`,
      },
    ],
  },
  {
    slug: "two-factor",
    title: "Two-factor sign-in",
    summary: "Protect logins with a code from an authenticator app — and require it for your office staff.",
    audience: "company",
    sections: [
      {
        id: "setup",
        title: "Turn it on for your login",
        body: `1. Install an authenticator app on your phone: **Google Authenticator**, **Microsoft Authenticator**, **Authy** or **1Password**.
2. In the dashboard menu open **Two-factor sign-in** → **Set up an authenticator app**.
3. Scan the QR code with the app (or type the key shown under it), then type the 6-digit code the app shows.

**Every admin and dispatcher needs it.** A new login gets **3 days** to set it up (for a new company, counted from when its account is approved): each sign-in reminds you, with **Remind me later**. After 3 days the dashboard only opens once it's set up. Drivers never need it.

From then on, every sign-in asks for the current code after your password. Someone who steals or guesses your password still can't get in — not through the website, and not through the database either.`,
      },
      {
        id: "require",
        title: "Require it straight away (admins)",
        body: `On the **Two-factor sign-in** page, admins can tick **Require two-factor sign-in for office staff** to skip the 3 days: every admin and dispatcher without an authenticator must then set one up the next time they sign in, before doing anything else. Drivers are never asked.

You need your own authenticator set up first, so you can't lock yourself out.`,
      },
      {
        id: "lost",
        title: "Lost or new phone",
        body: `- **New phone, old one still working**: on **Two-factor sign-in**, press **Remove / replace authenticator**, then set it up again on the new phone.
- **Phone lost**: ask us (the platform owner) to reset your two-factor sign-in. Then sign in with your password and set up a new authenticator.`,
      },
    ],
  },
  {
    slug: "plan-billing",
    title: "Plan & billing",
    summary: "Your plan, usage, invoices, changing plan and cancelling.",
    audience: "company",
    sections: [
      {
        id: "usage",
        title: "Your plan and usage",
        body: `**Admin → Plan & billing** shows your plan, its price, the next payment date (or the end of your free trial), and bars for **drivers**, **office users** and **bookings this month** against your plan's limits.

At a limit, adding more is refused with an upgrade message. Bookings count per calendar month; a return trip counts once.`,
      },
      {
        id: "manage",
        title: "Pay invoices, change plan or cancel",
        body: `**How you pay:** a few days before each billing date (the end of your free trial, then every month) we send you a **payment link by email or WhatsApp**. Pay it there. Your card is **never saved and never charged automatically** — nothing is taken unless you pay a link yourself.

**Admin → Plan & billing → Invoices** lists your invoices: period, amount, **Upcoming / Payment link sent / Overdue / Paid**, the due date or the day you paid, and a **Pay now** button when the link is there.

**Change plan or cancel:** email us (the address is on the Plan & billing page) and we'll change it for you.`,
      },
      {
        id: "unpaid",
        title: "If an invoice isn't paid",
        body: `After the due date your account keeps working for a while and shows **Payment overdue**. Pay with the link we sent you (also under **Invoices**). If it stays unpaid we may **switch the account off**: the booking page, dispatch board and driver app stop — your data is kept, and everything comes back once it is paid.`,
      },
    ],
  },
  {
    slug: "backups",
    title: "Backups and restore",
    summary: "Your data is backed up every night. Download or restore it.",
    audience: "company",
    sections: [
      {
        id: "what",
        title: "What is backed up",
        body: `Every night a copy of **your company's data only** is saved: bookings, customers, drivers, payments, prices, settings and logs. Copies are kept for **30 days**. Logins are not part of a backup.`,
      },
      {
        id: "download",
        title: "Download or take a backup now",
        body: `**Admin → Backups** (Pro and Business plans)

- **Back up now** — before a big change, e.g. rewriting your prices.
- **Download** — saves a copy to your computer.`,
      },
      {
        id: "restore",
        title: "Restore",
        body: `1. In **Admin → Backups**, press **Restore** next to the day you want.
2. Read the warning, type your company name and confirm.

Everything goes back to how it was then; anything added since is removed. A backup of "now" is taken first, so a restore can itself be undone. Money already taken by Stripe and texts already sent can't be undone.

**Starter plan:** downloads and restores aren't included, but you are still backed up nightly. Request a restore on **Plan & billing → Restore your data** and we do it for you.`,
      },
    ],
  },
  {
    slug: "setup-help",
    title: "Setup help",
    summary: "Ask us to set up payments, email, SMS and pricing for you.",
    audience: "company",
    sections: [
      {
        id: "request",
        title: "Ask for help",
        body: `**Plan & billing → We'll set it up for you**

1. Write anything useful in the box (your website, best time to call).
2. Choose a package and press **Choose and pay** (or **Request**).
3. We email you to arrange the details.

!> Never send passwords or keys by email. We'll arrange a call and you paste keys into your own Settings yourself, or we guide you through it.`,
      },
    ],
  },
];
