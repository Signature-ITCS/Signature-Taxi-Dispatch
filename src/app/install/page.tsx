import InstallApp from "@/components/InstallApp";
import BrandScope from "@/components/BrandScope";

// Reads plans / names from the database: render on each request, never at build time.
export const dynamic = "force-dynamic";

/** Customer app install page — linked from booking and thank-you emails. */
export default function InstallPage() {
  return (
    <BrandScope companyId={null}>
      <InstallApp variant="customer" />
    </BrandScope>
  );
}
