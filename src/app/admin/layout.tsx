import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import AdminShell from "@/components/admin/AdminShell";
import { staffMetadata } from "@/lib/staffMetadata";

export const metadata = staffMetadata;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login?next=/admin");
  // Admin panel is admins only. Dispatchers have their own area at /dispatch.
  if (profile.role !== "admin") {
    redirect("/dispatch");
  }

  return <AdminShell name={profile.full_name || "Admin"}>{children}</AdminShell>;
}
