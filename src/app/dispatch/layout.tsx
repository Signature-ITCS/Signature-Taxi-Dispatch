import { redirect } from "next/navigation";
import DispatchShell from "@/components/dispatch/DispatchShell";
import BrandScope from "@/components/BrandScope";
import { staffMetadataFor } from "@/lib/staffMetadata";
import { getStaffContext, getPlatformAdmin, companyIsOpen } from "@/lib/tenant";
import { getCompanyBrand } from "@/lib/companyBrand";

export async function generateMetadata() {
  const ctx = await getStaffContext();
  const brand = ctx ? await getCompanyBrand(ctx.company.id) : null;
  return staffMetadataFor(brand?.name, brand?.slug);
}

export default async function DispatchLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getStaffContext();
  if (!ctx) {
    if (await getPlatformAdmin()) redirect("/master");
    redirect("/login?next=/dispatch");
  }
  if (!ctx.profile.is_active) redirect("/login?next=/dispatch");
  if (!companyIsOpen(ctx.company)) redirect("/account");
  if (ctx.profile.role !== "dispatcher" && ctx.profile.role !== "admin") {
    redirect("/login?next=/dispatch&need=dispatcher");
  }
  return (
    <BrandScope companyId={ctx.company.id}>
      <DispatchShell name={ctx.profile.full_name || "Dispatcher"} isAdmin={ctx.profile.role === "admin"}>
        {children}
      </DispatchShell>
    </BrandScope>
  );
}
