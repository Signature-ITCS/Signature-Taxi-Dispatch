import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BookingWidget from "@/components/booking/BookingWidget";
import BrandScope from "@/components/BrandScope";
import { resolveBookingSite } from "@/lib/tenant";
import { getCompanyBrand } from "@/lib/companyBrand";
import { cardPaymentsEnabled } from "@/lib/paymentMethods";

/** A company's own booking page: /book/<its slug>. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const site = await resolveBookingSite(slug);
  if (!site) return { title: "Booking" };
  const brand = await getCompanyBrand(site.company_id);
  return {
    title: `${brand.name} — Book a taxi`,
    description: `Book a ${brand.name} taxi online.`,
    applicationName: brand.name,
    manifest: `/api/manifest/customer?c=${encodeURIComponent(site.slug)}`,
    appleWebApp: { title: brand.name, capable: true, statusBarStyle: "default" },
  };
}

export default async function CompanyBookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await resolveBookingSite(slug);
  if (!site) notFound();
  return (
    <BrandScope companyId={site.company_id}>
      <BookingWidget site={site.slug} cardEnabled={await cardPaymentsEnabled(site.company_id)} />
    </BrandScope>
  );
}
