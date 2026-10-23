import { headers } from "next/headers";
import BrandScope from "@/components/BrandScope";
import { staffMetadataFor } from "@/lib/staffMetadata";
import { getCompanyByDomain } from "@/lib/tenant";
import { getCompanyBrand } from "@/lib/companyBrand";

/** Shared sign-in — in the company's colours on its own domain, the platform's otherwise. */
async function domainCompanyId(): Promise<string | null> {
  return (await getCompanyByDomain((await headers()).get("host") ?? ""))?.id ?? null;
}

export async function generateMetadata() {
  const id = await domainCompanyId();
  const brand = id ? await getCompanyBrand(id) : null;
  return staffMetadataFor(brand?.name, brand?.slug);
}

export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  return <BrandScope companyId={await domainCompanyId()}>{children}</BrandScope>;
}
