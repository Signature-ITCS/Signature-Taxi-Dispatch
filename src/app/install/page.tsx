import InstallApp from "@/components/InstallApp";
import BrandScope from "@/components/BrandScope";

/** Customer app install page — linked from booking and thank-you emails. */
export default function InstallPage() {
  return (
    <BrandScope companyId={null}>
      <InstallApp variant="customer" />
    </BrandScope>
  );
}
