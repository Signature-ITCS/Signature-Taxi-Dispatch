import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import BrandScope from "@/components/BrandScope";
import { getStaffContext, getPlatformAdmin, companyIsOpen } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { listPlans } from "@/lib/billing";
import { getServices, getSupportEmail } from "@/lib/services";
import { homeForRole } from "@/lib/auth";
import AccountActions from "./AccountActions";
import Invoices from "./Invoices";

export const metadata = { title: "Plan & billing" };

const STATUS: Record<string, { label: string; tone: string }> = {
  trialing: { label: "Free trial", tone: "bg-brand-50 text-brand-700" },
  active: { label: "Active", tone: "bg-emerald-50 text-emerald-700" },
  past_due: { label: "Payment overdue", tone: "bg-amber-50 text-amber-800" },
  suspended: { label: "Suspended", tone: "bg-red-50 text-red-700" },
  cancelled: { label: "Cancelled", tone: "bg-red-50 text-red-700" },
};

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }) : null;

/**
 * The company's plan, what it is using, and billing. Open to the company's
 * staff even while it is suspended — it is where they pay to unlock it.
 */
export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await getStaffContext();
  if (!ctx) {
    if (await getPlatformAdmin()) redirect("/master");
    redirect("/login?next=/account");
  }
  const sp = await searchParams;
  const c = ctx.company;
  const [{ data: usage }, plans, services, supportEmail] = await Promise.all([
    createAdminClient().rpc("company_usage", { p_company: c.id }),
    listPlans(),
    getServices(),
    getSupportEmail(),
  ]);
  const u = (usage ?? {}) as Record<string, number | string | boolean | null>;
  const plan = plans.find((p) => p.id === c.plan_id);
  const open = companyIsOpen(c);
  const isAdmin = ctx.profile.role === "admin";
  const st = STATUS[c.status] ?? STATUS.active;

  const meters: [string, number, number | null][] = [
    ["Drivers", Number(u.drivers ?? 0), (u.max_drivers as number | null) ?? null],
    ["Office users", Number(u.staff ?? 0), (u.max_staff as number | null) ?? null],
    ["Bookings this month", Number(u.bookings_this_month ?? 0), (u.max_bookings_month as number | null) ?? null],
  ];

  return (
    <BrandScope companyId={c.id}>
      <main className="min-h-screen bg-gray-50 p-4 sm:p-8">
        <div className="mx-auto max-w-3xl space-y-5">
          {open && (
            <a href={homeForRole(ctx.profile.role)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-ink-950">
              <ArrowLeft className="h-4 w-4" /> Back to the dashboard
            </a>
          )}

          {!open && (
            <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">
                  {c.status === "cancelled" ? "This account has been cancelled." : "This account is paused."}
                </p>
                <p className="mt-0.5">
                  Bookings, the dispatch board and the driver app are switched off until the subscription is paid.
                  {isAdmin ? " Use “Manage billing” below." : " Please ask your administrator."}
                  {supportEmail ? ` Questions: ${supportEmail}.` : ""}
                </p>
              </div>
            </div>
          )}

          <section className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm text-gray-500">{c.name}</p>
                <h1 className="font-display text-2xl font-bold text-ink-950">{plan?.name ?? "No plan"} plan</h1>
                {plan && <p className="text-sm text-gray-500">£{Number(plan.price_monthly).toFixed(0)} a month</p>}
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${st.tone}`}>{st.label}</span>
            </div>
            <div className="mt-3 space-y-1 text-sm text-gray-600">
              {c.status === "trialing" && day(c.trial_ends_at) && <p>Free trial until {day(c.trial_ends_at)}.</p>}
              {c.status !== "trialing" && day(c.current_period_end) && <p>Next invoice on {day(c.current_period_end)}.</p>}
            </div>

            <div className="mt-6 space-y-4">
              {meters.map(([label, used, max]) => {
                const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
                return (
                  <div key={label}>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-700">{label}</span>
                      <span className="font-medium text-ink-950">
                        {used.toLocaleString("en-GB")} {max != null ? `of ${max.toLocaleString("en-GB")}` : "(unlimited)"}
                      </span>
                    </div>
                    {max != null && (
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100">
                        <div className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-brand-500"}`} style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
              <p className="text-sm text-gray-600">
                Backups: your data is backed up every night.{" "}
                {u.backups_included
                  ? "You can download or restore them yourself in Admin → Backups."
                  : `Downloads and self-service restore aren't included in this plan — if you ever need data restored, we can do it for you${services.restore_price ? ` for £${services.restore_price}` : ""}.`}
              </p>
            </div>
          </section>

          {isAdmin && c.stripe_customer_id && <Invoices />}

          {isAdmin ? (
            <AccountActions
              hasBilling={!!c.stripe_customer_id}
              supportEmail={supportEmail}
              packages={services.setup_packages}
              restorePrice={services.restore_price}
              backupsIncluded={!!u.backups_included}
              requested={sp.requested ?? null}
              unpaid={!!sp.unpaid}
            />
          ) : (
            <p className="text-center text-sm text-gray-500">Only an administrator can change the plan or billing.</p>
          )}
        </div>
      </main>
    </BrandScope>
  );
}
