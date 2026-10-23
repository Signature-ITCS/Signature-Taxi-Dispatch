import { notFound } from "next/navigation";
import InstallApp from "@/components/InstallApp";
import BrandScope from "@/components/BrandScope";
import { getCompanyBySlug } from "@/lib/tenant";
import { getCompanyBrand } from "@/lib/companyBrand";
import { driverMetadataFor } from "@/lib/staffMetadata";

/** A company's driver app install page — linked from the driver welcome email. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const company = await getCompanyBySlug((await params).slug);
  if (!company) return {};
  return driverMetadataFor((await getCompanyBrand(company.id)).name, company.slug);
}

export default async function CompanyDriverInstallPage({ params }: { params: Promise<{ slug: string }> }) {
  const company = await getCompanyBySlug((await params).slug);
  if (!company) notFound();
  return (
    <BrandScope companyId={company.id}>
      <InstallApp variant="driver" />
    </BrandScope>
  );
}
