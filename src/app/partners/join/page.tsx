import { getPlatformName } from "@/lib/companyBrand";
import { partnerPrice, COMMON_COUNCILS } from "@/lib/partners";
import JoinForm from "./JoinForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join the partner network", robots: { index: false, follow: false } };

/** Drivers and sole-trader operators apply to join the partner network. */
export default async function PartnerJoinPage() {
  const [name, price] = await Promise.all([getPlatformName(), partnerPrice()]);
  return (
    <main className="flex min-h-screen items-start justify-center bg-gradient-to-b from-brand-50/60 to-white p-4 sm:items-center">
      <JoinForm platformName={name} price={price} councils={COMMON_COUNCILS} />
    </main>
  );
}
