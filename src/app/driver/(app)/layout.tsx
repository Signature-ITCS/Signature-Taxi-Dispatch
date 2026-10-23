import { redirect } from "next/navigation";
import { homeForRole } from "@/lib/auth";
import { getStaffContext, companyIsOpen } from "@/lib/tenant";

/**
 * Only drivers get into the driver app — and only while their company may use
 * the system. Staff who land here are sent to their own board; anyone else
 * signs in first.
 */
export default async function DriverAppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getStaffContext();
  if (!ctx || !ctx.profile.is_active) redirect("/driver/login");
  if (ctx.profile.role !== "driver") redirect(homeForRole(ctx.profile.role));
  if (!companyIsOpen(ctx.company)) redirect("/driver/login?suspended=1");
  return children;
}
