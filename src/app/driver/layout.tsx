import { headers } from "next/headers";
import BrandScope from "@/components/BrandScope";
import { driverMetadataFor } from "@/lib/staffMetadata";
import { getStaffContext, getCompanyByDomain } from "@/lib/tenant";
import { getCompanyBrand } from "@/lib/companyBrand";

/** The driver's company — or, before sign-in, the company whose domain this is. */
async function driverCompanyId(): Promise<string | null> {
  const ctx = await getStaffContext();
  if (ctx) return ctx.company.id;
  const byDomain = await getCompanyByDomain((await headers()).get("host") ?? "");
  return byDomain?.id ?? null;
}

export async function generateMetadata() {
  const id = await driverCompanyId();
  const brand = id ? await getCompanyBrand(id) : null;
  return driverMetadataFor(brand?.name, brand?.slug);
}

export default async function DriverAreaLayout({ children }: { children: React.ReactNode }) {
  return <BrandScope companyId={await driverCompanyId()}>{children}</BrandScope>;
}
