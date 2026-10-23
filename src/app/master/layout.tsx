import { redirect } from "next/navigation";
import { getPlatformAdmin } from "@/lib/tenant";
import { getPlatformName } from "@/lib/companyBrand";
import BrandScope from "@/components/BrandScope";
import MasterShell from "./MasterShell";

export const metadata = { title: "Master dashboard" };

/** The platform owner's own area. Nobody else — not even a company admin — gets in. */
export default async function MasterLayout({ children }: { children: React.ReactNode }) {
  const owner = await getPlatformAdmin();
  if (!owner) redirect("/login?next=/master");
  return (
    <BrandScope companyId={null}>
      <MasterShell platformName={await getPlatformName()} email={owner.email ?? ""}>
        {children}
      </MasterShell>
    </BrandScope>
  );
}
