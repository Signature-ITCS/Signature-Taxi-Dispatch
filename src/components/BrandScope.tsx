import { getCompanyBrand } from "@/lib/companyBrand";
import { brandCss } from "@/lib/brandColors";
import { BrandProvider } from "@/components/BrandProvider";

/**
 * Wrap a company's screens: its colours (as CSS variables) and its name/logo
 * (for client components via useBrand). companyId null = the platform itself.
 */
export default async function BrandScope({ companyId, children }: { companyId: string | null; children: React.ReactNode }) {
  const b = await getCompanyBrand(companyId);
  return (
    <>
      {/* Validated hex only — see brandColors.ts. */}
      <style dangerouslySetInnerHTML={{ __html: brandCss(b.primary, b.dark) }} />
      <BrandProvider
        brand={{
          name: b.name,
          slug: b.slug,
          primary: b.primary,
          dark: b.dark,
          logoUrl: b.logoUrl,
          legalName: b.legalName,
          contact: b.contact,
        }}
      >
        {children}
      </BrandProvider>
    </>
  );
}
