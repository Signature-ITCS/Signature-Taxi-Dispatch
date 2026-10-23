import { notFound } from "next/navigation";
import SignIn from "@/components/SignIn";
import BrandScope from "@/components/BrandScope";
import { getCompanyBySlug } from "@/lib/tenant";
import { getCompanyBrand } from "@/lib/companyBrand";
import { driverMetadataFor } from "@/lib/staffMetadata";

/** A company's driver sign-in, in its own name and colours: /<company>/driver. */
type Props = { params: Promise<{ company: string }> };

export async function generateMetadata({ params }: Props) {
  const c = await getCompanyBySlug((await params).company);
  if (!c) return {};
  return driverMetadataFor((await getCompanyBrand(c.id)).name, c.slug);
}

export default async function CompanyDriverLoginPage({ params }: Props) {
  const c = await getCompanyBySlug((await params).company);
  if (!c) notFound();
  return (
    <BrandScope companyId={c.id}>
      <SignIn title="Driver Sign In" subtitle="Use the login your office sent you" />
    </BrandScope>
  );
}
