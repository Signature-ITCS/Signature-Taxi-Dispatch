import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { staffMetadata } from "@/lib/staffMetadata";

export const metadata = staffMetadata;

/**
 * Printable pages (receipts, reports) for admins AND dispatchers.
 *
 * They live outside /admin (admins only) and /dispatch (which wraps every page
 * in the dispatch menu), so either role can open them and nothing but the
 * document itself is printed.
 */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin" && profile.role !== "dispatcher") redirect("/login");
  return <div className="min-h-screen bg-gray-100 print:bg-white">{children}</div>;
}
