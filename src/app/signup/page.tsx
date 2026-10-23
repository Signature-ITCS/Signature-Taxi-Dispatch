import { listPlans } from "@/lib/billing";
import { getPlatformName } from "@/lib/companyBrand";
import SignupForm from "./SignupForm";

// Reads plans / names from the database: render on each request, never at build time.
export const dynamic = "force-dynamic";

export const metadata = { title: "Start your free trial" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [plans, name] = await Promise.all([listPlans({ publicOnly: true }), getPlatformName()]);
  const wanted = (await searchParams).plan;
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50/60 to-white p-4">
      <SignupForm
        platformName={name}
        plans={plans.map((p) => ({ code: p.code, name: p.name, price: Number(p.price_monthly), trialDays: p.trial_days }))}
        initialPlan={plans.some((p) => p.code === wanted) ? wanted! : plans[0]?.code ?? ""}
      />
    </main>
  );
}
