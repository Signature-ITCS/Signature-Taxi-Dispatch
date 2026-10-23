import { notFound } from "next/navigation";
import InstallApp from "@/components/InstallApp";
import BrandScope from "@/components/BrandScope";
import { getCompanyBySlug } from "@/lib/tenant";
import { getCompanyBrand } from "@/lib/companyBrand";
import { staffMetadataFor } from "@/lib/staffMetadata";

/** A company's staff app install page — linked from the staff welcome email. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const company = await getCompanyBySlug((await params).slug);
  if (!company) return {};
  return staffMetadataFor((await getCompanyBrand(company.id)).name, company.slug);
}

export default async function CompanyStaffInstallPage({ params }: { params: Promise<{ slug: string }> }) {
  const company = await getCompanyBySlug((await params).slug);
  if (!company) notFound();
  return (
    <BrandScope companyId={company.id}>
      <InstallApp variant="staff" />
    </BrandScope>
  );
}
