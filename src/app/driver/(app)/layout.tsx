import { redirect } from "next/navigation";
import { getSessionProfile, homeForRole } from "@/lib/auth";

/**
 * Only drivers get into the driver app. Staff who land here are sent to their
 * own board; anyone else signs in first.
 */
export default async function DriverAppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getSessionProfile();
  if (!profile || !profile.is_active) redirect("/driver/login");
  if (profile.role !== "driver") redirect(homeForRole(profile.role));
  return children;
}
