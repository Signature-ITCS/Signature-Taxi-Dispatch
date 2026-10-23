import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CarFront, Check, LayoutDashboard, Smartphone, Bell, ShieldCheck } from "lucide-react";
import { homeForRole } from "@/lib/auth";
import { getStaffContext, getPlatformAdmin, getCompanyByDomain, companyWebsite } from "@/lib/tenant";
import { getPlatformName } from "@/lib/companyBrand";
import { listPlans } from "@/lib/billing";

export async function generateMetadata(): Promise<Metadata> {
  const name = await getPlatformName();
  return { title: `${name} — taxi booking and dispatch`, description: "Online booking, dispatch and driver apps for taxi and transfer companies." };
}

/**
 * "/" — signed-in people go to their own screens; on a company's own domain
 * customers go to its booking page; otherwise this is the platform's home page
 * with the plans.
 */
export default async function Home() {
  if (await getPlatformAdmin()) redirect("/master");
  const ctx = await getStaffContext();
  if (ctx && ctx.profile.is_active) redirect(homeForRole(ctx.profile.role));

  const byDomain = await getCompanyByDomain((await headers()).get("host") ?? "");
  if (byDomain) {
    const site = await companyWebsite(byDomain.id);
    if (site) redirect(`/book/${site.slug}`);
  }

  const [name, plans] = await Promise.all([getPlatformName(), listPlans({ publicOnly: true })]);
  const limit = (n: number | null, what: string) => (n == null ? `Unlimited ${what}` : `${n} ${what}`);

  return (
    <main className="min-h-screen bg-gradient-to-b from-brand-50/60 to-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-950 text-white">
            <CarFront className="h-5 w-5" />
          </span>
          <span className="font-display text-lg font-bold text-ink-950">{name}</span>
        </div>
        <a href="/login" className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-ink-950 hover:border-gray-300">
          Sign in
        </a>
      </header>

      <section className="mx-auto max-w-3xl px-5 pb-10 pt-10 text-center">
        <h1 className="font-display text-4xl font-bold tracking-tight text-ink-950 sm:text-5xl">
          Your own booking site, dispatch board and driver app
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-gray-600">
          Customers book and pay online, your office dispatches, drivers get every job on their phone. In your name, your
          colours — ready in minutes.
        </p>
        <div className="mx-auto mt-8 grid max-w-2xl grid-cols-2 gap-3 text-left sm:grid-cols-4">
          {[
            [LayoutDashboard, "Dispatch board"],
            [Smartphone, "Driver app"],
            [Bell, "SMS and email"],
            [ShieldCheck, "Secure and backed up"],
          ].map(([Icon, label]) => {
            const I = Icon as typeof Bell;
            return (
              <div key={label as string} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-sm text-gray-700 shadow-sm">
                <I className="h-4 w-4 text-brand-600" /> {label as string}
              </div>
            );
          })}
        </div>
      </section>

      <section id="plans" className="mx-auto max-w-6xl px-5 pb-20">
        <div className="grid gap-5 md:grid-cols-3">
          {plans.map((p, i) => (
            <div
              key={p.id}
              className={`flex flex-col rounded-3xl border bg-white p-6 shadow-sm ${i === 1 ? "border-brand-500 ring-2 ring-brand-500/20" : "border-gray-100"}`}
            >
              {i === 1 && (
                <span className="mb-3 self-start rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">Most popular</span>
              )}
              <h2 className="font-display text-xl font-bold text-ink-950">{p.name}</h2>
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
                className={`mt-6 rounded-xl py-2.5 text-center text-sm font-semibold ${i === 1 ? "bg-brand-600 text-white hover:bg-brand-700" : "bg-ink-950 text-white hover:bg-ink-800"}`}
              >
                {p.trial_days > 0 ? `Start ${p.trial_days}-day free trial` : "Get started"}
              </a>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-gray-500">
          Need help with setup? We can connect your payments, SMS and email for you — just ask after you sign up.
        </p>
      </section>
    </main>
  );
}
