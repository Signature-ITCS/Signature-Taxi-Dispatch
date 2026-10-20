import InstallApp from "@/components/InstallApp";
import { staffMetadata } from "@/lib/staffMetadata";

// Links the staff manifest, so the browser offers the staff app (opens /login).
export const metadata = staffMetadata;

/** Staff app install page — linked from the staff welcome email. */
export default function StaffInstallPage() {
  return <InstallApp variant="staff" />;
}
