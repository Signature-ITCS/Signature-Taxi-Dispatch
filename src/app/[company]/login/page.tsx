import { notFound } from "next/navigation";
import SignIn from "@/components/SignIn";
import BrandScope from "@/components/BrandScope";
import { getCompanyBySlug } from "@/lib/tenant";
import { getCompanyBrand } from "@/lib/companyBrand";
import { staffMetadataFor } from "@/lib/staffMetadata";

/** A company's staff sign-in, in its own name and colours: /<company>/login. */
type Props = { params: Promise<{ company: string }> };

export async function generateMetadata({ params }: Props) {
  const c = await getCompanyBySlug((await params).company);
  if (!c) return {};
  return staffMetadataFor((await getCompanyBrand(c.id)).name, c.slug);
}

export default async function CompanyLoginPage({ params }: Props) {
  const c = await getCompanyBySlug((await params).company);
  if (!c) notFound();
  return (
    <BrandScope companyId={c.id}>
      <SignIn title="Staff Sign In" subtitle="Dispatchers & admins" />
    </BrandScope>
  );
}
