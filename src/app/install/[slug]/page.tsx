import type { Metadata } from "next";
import { notFound } from "next/navigation";
import InstallApp from "@/components/InstallApp";
import BrandScope from "@/components/BrandScope";
import { resolveBookingSite } from "@/lib/tenant";
import { getCompanyBrand } from "@/lib/companyBrand";

/** A company's customer app install page — linked from its booking and thank-you emails. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const site = await resolveBookingSite((await params).slug);
  if (!site) return {};
  const brand = await getCompanyBrand(site.company_id);
  return { title: brand.name, manifest: `/api/manifest/customer?c=${encodeURIComponent(site.slug)}` };
}

export default async function CompanyInstallPage({ params }: { params: Promise<{ slug: string }> }) {
  const site = await resolveBookingSite((await params).slug);
  if (!site) notFound();
  return (
    <BrandScope companyId={site.company_id}>
      <InstallApp variant="customer" />
    </BrandScope>
  );
}
