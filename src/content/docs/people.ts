import type { DocPage } from "./types";

/** Day-to-day guides: dispatch, drivers and customers. */
export const dispatchPages: DocPage[] = [
  {
    slug: "dispatch-board",
    title: "The dispatch board",
    summary: "Live jobs, assigning drivers, and following each job to completion.",
    audience: "dispatch",
    sections: [
      {
        id: "overview",
        title: "What you see",
        body: `**Dispatch** shows **Live operations**: every open job, newest and most urgent first, with counters for pending jobs and cash today.

- **Jobs** — jobs that need action now, and pre-bookings from an hour before pickup.
- **Scheduled** — pre-booked jobs further ahead. They move to Jobs an hour before pickup.
- A **sound** plays and the 🔔 bell counts up for every new booking and update.`,
      },
      {
        id: "assign",
        title: "Assign a driver",
        body: `1. Open a job and press **Assign Driver**.
2. Search and pick a driver. Busy drivers are marked.
3. The driver's phone gets a push notification. The job shows **Assigned**, then **Accepted** when they accept.

If a driver declines, the job comes back to you to give to someone else.`,
      },
      {
        id: "statuses",
        title: "Job statuses",
        body: `- **Pending** — new, no driver yet.
- **Assigned** — given to a driver, not accepted yet.
- **Accepted** — driver is on it.
- **Driver arrived** — customer has been texted.
- **In progress** — passenger picked up.
- **Completed** — finished; the customer gets a thank-you.
- **Cancelled**.

Drivers move jobs along in their app. From the board you can also **Mark driver arrived**, **Start trip** and **Complete trip** for drivers without the app.`,
      },
      {
        id: "new-booking",
        title: "Take a phone booking",
        body: `Press **New Booking**, fill in the journey and customer, pick a car and payment. You can type a **custom price** if you agreed one. The customer gets the same confirmation text and email as an online booking.`,
      },
      {
        id: "outside-job",
        title: "Outside jobs",
        body: `When no driver is free and you book the customer a ride elsewhere (Uber, a partner firm), record it with **Outside job** so your takings and history stay complete. You can also give an existing job to an **Outside driver** with their name, phone and car — the customer can still track it.`,
      },
    ],
  },
  {
    slug: "bookings",
    title: "Bookings, receipts and reports",
    summary: "Find any booking, change its status, print receipts and export reports.",
    audience: "dispatch",
    sections: [
      {
        id: "find",
        title: "Find a booking",
        body: `**Bookings** lists every booking. Filter by **today**, a chosen **day** or a **date range**, by **Paid / Unpaid**, and search by reference, name or phone. Sort by journey date or booking time.`,
      },
      {
        id: "details",
        title: "Change a booking",
        body: `Open a booking to see the full journey, customer, driver, price breakdown and history. You can set its **job status** (processing, on hold, completed, cancelled, refunded) and its **payment** (unpaid, paid by card, paid by cash).`,
      },
      {
        id: "receipts",
        title: "Receipts",
        body: `On a completed booking press **Print receipt** or **Download receipt** (choose "Save as PDF" in the print window). Receipts show your logo, legal name and contact details from Settings.`,
      },
      {
        id: "export",
        title: "Reports and exports",
        body: `Press **Report** for a printable bookings report, or **Export** to download bookings by payment type and driver for a chosen period.`,
      },
    ],
  },
  {
    slug: "calendar-map",
    title: "Calendar, map and notifications",
    summary: "See pre-bookings by day, where drivers are, and what just happened.",
    audience: "dispatch",
    sections: [
      {
        id: "calendar",
        title: "Calendar",
        body: `**Calendar** shows pre-booked journeys by date, so you can see busy days ahead. Click a job to open it.`,
      },
      {
        id: "map",
        title: "Driver map",
        body: `**Driver map** shows every driver using the app, live, with their name and whether they are free or busy. Drivers must be online in the app and allow location.`,
      },
      {
        id: "bell",
        title: "Notification bell",
        body: `The 🔔 lists the latest events: new bookings, accepts and declines, arrivals, completions, payments and **pickups within the hour** (red when no driver is assigned yet). Opening it marks them as seen.`,
      },
    ],
  },
  {
    slug: "customers",
    title: "Customers",
    summary: "Your customer list, history and blocking.",
    audience: "dispatch",
    sections: [
      {
        id: "list",
        title: "Customer list",
        body: `**Customers** keeps one record per phone number with their name, email and number of rides. A returning customer is recognised by their number. You can **block** a customer — they can no longer book online.`,
      },
    ],
  },
];

export const driverPages: DocPage[] = [
  {
    slug: "driver-app",
    title: "Driver app",
    summary: "Install the app, go online, and take jobs from start to finish.",
    audience: "driver",
    sections: [
      {
        id: "install",
        title: "Install it",
        body: `Your office emails you a login and an **Install the app** link.

- **iPhone:** open the link in **Safari**, tap **Share → Add to Home Screen**.
- **Android:** open it in **Chrome** and tap **Install** (or menu ⋮ → **Install app**).

Then open it from your home screen and sign in. When asked, **allow notifications** and **allow location** — without them you won't get new jobs or appear on the office map.`,
      },
      {
        id: "online",
        title: "Go online",
        body: `Tap **Go online** to start receiving jobs. Go offline when you finish — you won't get jobs while offline.`,
      },
      {
        id: "jobs",
        title: "Doing a job",
        body: `1. A new job arrives as a notification. Open it and tap **Accept booking** (or decline — it goes back to the office).
2. When you set off, tap **On my way**.
3. At the pickup, tap **I've arrived** — the customer gets a text with your car.
4. When the passenger is in, tap **Picked up**.
5. At the drop-off, tap **Complete**. For cash jobs, confirm you collected the cash.

Use **Navigate** to open your maps app, and **Call** to ring the customer.`,
      },
      {
        id: "history",
        title: "History and cash",
        body: `See your past jobs and your cash totals (what you've collected and what has been settled with the office) in the app's other tabs.`,
      },
      {
        id: "problems",
        title: "Not getting jobs?",
        body: `- Make sure you are **online**.
- Check notifications are allowed for the app in your phone's settings.
- On iPhone the app must be installed from Safari to the home screen for notifications to work.`,
      },
    ],
  },
];

export const customerPages: DocPage[] = [
  {
    slug: "customer-booking",
    title: "Booking, paying and tracking",
    summary: "What your customers see — useful when they call to ask.",
    audience: "customer",
    sections: [
      {
        id: "book",
        title: "Booking",
        body: `1. On the booking page, enter the pickup, any stops and the drop-off, and choose **now** or a time. Tick a return journey if needed.
2. Press **See prices** and choose a car.
3. Enter a name (optional), mobile number and email (optional).
4. Choose **Cash** or **Card**. Card opens Stripe's secure page; the booking is made once the payment goes through.`,
      },
      {
        id: "track",
        title: "Tracking and rating",
        body: `The confirmation text and email include a **tracking link**: it shows the booking status live, and the driver's name, car and plate once assigned. After the ride the customer can **rate** it on the same page.`,
      },
      {
        id: "app",
        title: "Install as an app",
        body: `Customers can add your booking page to their home screen (link in their confirmation email) and book in one tap next time.`,
      },
    ],
  },
];
