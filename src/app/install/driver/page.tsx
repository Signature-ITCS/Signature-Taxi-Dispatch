import InstallApp from "@/components/InstallApp";
import BrandScope from "@/components/BrandScope";
import { driverMetadata } from "@/lib/staffMetadata";

// Links the driver manifest, so the browser offers the driver app (opens /driver).
export const metadata = driverMetadata;

/** Driver app install page — linked from the driver's welcome email. */
export default function DriverInstallPage() {
  return (
    <BrandScope companyId={null}>
      <InstallApp variant="driver" />
    </BrandScope>
  );
}
