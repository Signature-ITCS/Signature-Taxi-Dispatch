import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  CarFront, Check, LayoutDashboard, Smartphone, Bell, ShieldCheck, CreditCard, MapPinned, Tags, CalendarClock,
  Users, DatabaseBackup, MessageSquare, Globe,
} from "lucide-react";
import { homeForRole } from "@/lib/auth";
import { getStaffContext, getPlatformAdmin, getCompanyByDomain, companyWebsite } from "@/lib/tenant";
import { getPlatformName } from "@/lib/companyBrand";
import { listPlans } from "@/lib/billing";
import ProductTour from "@/components/landing/ProductTour";

export async function generateMetadata(): Promise<Metadata> {
  const name = await getPlatformName();
  return {
    title: `${name} — taxi booking and dispatch software`,
    description: "Online booking, dispatch board and driver app for taxi and airport transfer companies. Free 14-day trial.",
  };
}

const FEATURES: { icon: typeof Bell; title: string; text: string }[] = [
  { icon: Globe, title: "Online booking", text: "Your own booking page and a widget for your website. Customers get instant prices." },
  { icon: CreditCard, title: "Card or cash", text: "Card payments go straight into your own Stripe account. Cash is tracked per driver." },
  { icon: LayoutDashboard, title: "Dispatch board", text: "Every job live, with sound alerts, a notification bell and one-tap driver assignment." },
  { icon: Smartphone, title: "Driver app", text: "Jobs pushed to drivers' phones, with navigation and one-tap status updates." },
  { icon: MapPinned, title: "Live driver map", text: "See where every driver is and who is free, in real time." },
  { icon: Tags, title: "Flexible pricing", text: "Distance bands, airport and night charges, and fixed prices between areas you draw." },
  { icon: CalendarClock, title: "Pre-bookings", text: "Scheduled jobs, a calendar, and one-hour pickup reminders to drivers and office." },
  { icon: MessageSquare, title: "SMS and email", text: "Confirmations, \"driver arrived\" texts and thank-you emails — sent automatically." },
  { icon: Users, title: "Your team", text: "Office staff and driver logins, each seeing exactly what they need." },
  { icon: DatabaseBackup, title: "Backed up nightly", text: "Your data is backed up every night and can be restored to an earlier day." },
  { icon: ShieldCheck, title: "Private and secure", text: "Your data is completely separate from every other company. Keys are encrypted." },
  { icon: Bell, title: "Receipts and reports", text: "Printable receipts, booking reports and exports by payment type and driver." },
];

const FAQ: [string, string][] = [
  ["Do I need any technical knowledge?", "No. Sign up, choose your password and follow the setup checklist. If you'd rather not, we can set up payments, SMS and email for you."],
  ["Whose Stripe account do card payments go to?", "Yours. You connect your own Stripe account in Settings, so fares are paid straight to you."],
  ["Can I use my own domain and colours?", "Yes. Upload your logo, choose your colours, and your booking page, apps, emails and receipts all carry your brand."],
  ["What happens after the free trial?", "Your card is charged monthly for the plan you chose. You can change plan or cancel at any time from Plan & billing."],
  ["Is my data backed up?", "Every night, on every plan. Pro and Business can download and restore backups themselves; on Starter we restore for you on request."],
  ["Can I change plan later?", "Yes — upgrade or downgrade any time. If you reach your plan's driver, staff or booking limit, you'll be asked to upgrade."],
];

/**
 * "/" — signed-in people go to their own screens; on a company's own domain
 * customers go to its booking page; otherwise this is the platform's home page:
 * the product, a hands-on demo, and the plans.
 */
export default async function Home() {
  if (await getPlatformAdmin()) redirect("/master");
  const ctx = await getStaffContext();
  if (ctx && ctx.profile.is_active) redirect(homeForRole(ctx.profile.role));

  const byDomain = await getCompanyByDomain((await headers()).get("host") ?? "");
  if (byDomain) {
    const site = await companyWebsite(byDomain.id);
    if (site) redirect(`/${site.slug}`);
  }

  const [name, plans] = await Promise.all([getPlatformName(), listPlans({ publicOnly: true })]);
  const limit = (n: number | null, what: string) => (n == null ? `Unlimited ${what}` : `${n} ${what}`);
  const trialDays = plans.find((p) => p.trial_days > 0)?.trial_days ?? 0;

  return (
    <main className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-gray-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <a href="#" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-950 text-white">
              <CarFront className="h-5 w-5" />
            </span>
            <span className="font-display text-lg font-bold text-ink-950">{name}</span>
          </a>
          <nav className="hidden items-center gap-6 text-sm font-medium text-gray-600 md:flex">
            <a href="#demo" className="hover:text-ink-950">Demo</a>
            <a href="#features" className="hover:text-ink-950">Features</a>
            <a href="#plans" className="hover:text-ink-950">Pricing</a>
            <a href="#faq" className="hover:text-ink-950">FAQ</a>
            <Link href="/documentation" className="hover:text-ink-950">Docs</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-xl px-3 py-2 text-sm font-semibold text-ink-950 hover:bg-gray-50">Sign in</Link>
            <a href="#plans" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
              {trialDays ? "Start free trial" : "Get started"}
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-b from-brand-50/70 to-white">
        <div className="mx-auto max-w-3xl px-5 pb-12 pt-16 text-center">
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm">For taxi and airport transfer companies</span>
          <h1 className="mt-5 font-display text-4xl font-bold tracking-tight text-ink-950 sm:text-5xl">
            Your own booking site, dispatch board and driver app
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-gray-600">
            Customers book and pay online, your office dispatches, drivers get every job on their phone. In your name and
            your colours — ready in minutes.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href="#plans" className="rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 hover:bg-brand-700">
              {trialDays ? `Start your ${trialDays}-day free trial` : "Get started"}
            </a>
            <a href="#demo" className="rounded-xl border border-gray-200 bg-white px-6 py-3 text-sm font-semibold text-ink-950 hover:border-gray-300">
              Try the live demo
            </a>
          </div>
          <p className="mt-3 text-xs text-gray-400">No setup fee · cancel any time</p>
        </div>
      </section>

      {/* Demo */}
      <section id="demo" className="scroll-mt-20 bg-gradient-to-b from-white to-gray-50 px-5 py-16">
        <div className="mx-auto mb-8 max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold text-ink-950">See it in action</h2>
          <p className="mt-2 text-gray-600">Click around — assign a driver, book a ride, run a job on the driver app, or try your colours.</p>
        </div>
        <ProductTour />
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 px-5 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center font-display text-3xl font-bold text-ink-950">Everything a taxi office needs</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl border border-gray-100 p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                  <Icon className="h-5 w-5 text-brand-600" />
                </span>
                <h3 className="mt-3 font-semibold text-ink-950">{title}</h3>
                <p className="mt-1 text-sm text-gray-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-ink-950 px-5 py-16 text-white">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center font-display text-3xl font-bold">Up and running today</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              ["1", "Choose a plan", "Start your free trial — add a card on Stripe's secure page."],
              ["2", "Set your password", "Your login arrives by email. Add your logo, prices and drivers."],
              ["3", "Take bookings", "Share your booking page or add the widget to your website."],
            ].map(([n, t, d]) => (
              <div key={n} className="rounded-2xl bg-white/5 p-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 font-bold">{n}</span>
                <h3 className="mt-4 font-semibold">{t}</h3>
                <p className="mt-1 text-sm text-white/70">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Plans */}
      <section id="plans" className="scroll-mt-20 bg-gradient-to-b from-brand-50/50 to-white px-5 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold text-ink-950">Simple monthly plans</h2>
            <p className="mt-2 text-gray-600">{trialDays ? `Every plan starts with a ${trialDays}-day free trial.` : "Pick the plan that fits your fleet."} Change or cancel any time.</p>
          </div>
          {plans.length === 0 ? (
            <p className="text-center text-gray-500">Plans are coming soon.</p>
          ) : (
            <div className="grid gap-5 md:grid-cols-3">
              {plans.map((p, i) => {
                const featured = plans.length === 3 && i === 1;
                return (
                  <div
                    key={p.id}
                    className={`flex flex-col rounded-3xl border bg-white p-6 shadow-sm ${featured ? "border-brand-500 ring-2 ring-brand-500/20" : "border-gray-100"}`}
                  >
                    {featured && (
                      <span className="mb-3 self-start rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">Most popular</span>
                    )}
                    <h3 className="font-display text-xl font-bold text-ink-950">{p.name}</h3>
                    {p.description && <p className="mt-1 text-sm text-gray-500">{p.description}</p>}
                    <p className="mt-4">
                      <span className="font-display text-4xl font-bold text-ink-950">£{Number(p.price_monthly).toFixed(0)}</span>
                      <span className="text-sm text-gray-500"> /month</span>
                    </p>
                    <ul className="mt-5 flex-1 space-y-2 text-sm text-gray-700">
                      {[
                        limit(p.max_drivers, "drivers"),
                        limit(p.max_staff, "office users"),
                        `${p.max_bookings_month == null ? "Unlimited" : p.max_bookings_month.toLocaleString("en-GB")} bookings a month`,
                        ...(p.features ?? []),
                        ...(p.backups_included ? [] : ["Backup restore available as a paid service"]),
                      ].map((f) => (
                        <li key={f} className="flex gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {f}
                        </li>
                      ))}
                    </ul>
                    <a
                      href={`/signup?plan=${encodeURIComponent(p.code)}`}
                      className={`mt-6 rounded-xl py-2.5 text-center text-sm font-semibold ${featured ? "bg-brand-600 text-white hover:bg-brand-700" : "bg-ink-950 text-white hover:bg-ink-800"}`}
                    >
                      {p.trial_days > 0 ? `Start ${p.trial_days}-day free trial` : "Get started"}
                    </a>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-8 text-center text-sm text-gray-500">
            Need help with setup? We can connect your payments, SMS and email for you — just ask after you sign up.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 px-5 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center font-display text-3xl font-bold text-ink-950">Questions</h2>
          <div className="mt-8 divide-y divide-gray-100 rounded-2xl border border-gray-100">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group p-5">
                <summary className="cursor-pointer list-none font-semibold text-ink-950">
                  <span className="flex items-center justify-between gap-3">
                    {q} <span className="text-gray-400 transition group-open:rotate-45">+</span>
                  </span>
                </summary>
                <p className="mt-2 text-sm text-gray-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-gray-100 px-5 py-8 text-center text-sm text-gray-500">
        © {new Date().getFullYear()} {name} ·{" "}
        <Link href="/login" className="hover:text-ink-950">Sign in</Link> ·{" "}
        <a href="#plans" className="hover:text-ink-950">Pricing</a>
      </footer>
    </main>
  );
}
