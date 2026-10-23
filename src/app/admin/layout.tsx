import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import BrandScope from "@/components/BrandScope";
import { staffMetadataFor } from "@/lib/staffMetadata";
import { getStaffContext, getPlatformAdmin, companyIsOpen } from "@/lib/tenant";
import { getCompanyBrand } from "@/lib/companyBrand";

export async function generateMetadata() {
  const ctx = await getStaffContext();
  const brand = ctx ? await getCompanyBrand(ctx.company.id) : null;
  return staffMetadataFor(brand?.name, brand?.slug);
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getStaffContext();
  if (!ctx) {
    // The platform owner has no company of their own — their screens are /master.
    if (await getPlatformAdmin()) redirect("/master");
    redirect("/login?next=/admin");
  }
  if (!ctx.profile.is_active) redirect("/login?next=/admin");
  // Suspended or cancelled: only the account page (plan, billing) is open.
  if (!companyIsOpen(ctx.company)) redirect("/account");
  // Admin panel is admins only. Dispatchers have their own area at /dispatch.
  if (ctx.profile.role !== "admin") redirect("/dispatch");

  return (
    <BrandScope companyId={ctx.company.id}>
      <AdminShell name={ctx.profile.full_name || "Admin"}>{children}</AdminShell>
    </BrandScope>
  );
}
