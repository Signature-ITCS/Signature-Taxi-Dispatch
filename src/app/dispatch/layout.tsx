import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import DispatchShell from "@/components/dispatch/DispatchShell";
import { staffMetadata } from "@/lib/staffMetadata";

export const metadata = staffMetadata;

export default async function DispatchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login?next=/dispatch");
  if (profile.role !== "dispatcher" && profile.role !== "admin") {
    redirect("/login?next=/dispatch&need=dispatcher");
  }
  return (
    <DispatchShell name={profile.full_name || "Dispatcher"} isAdmin={profile.role === "admin"}>
      {children}
    </DispatchShell>
  );
}
