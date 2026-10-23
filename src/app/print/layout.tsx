import { redirect } from "next/navigation";
import BrandScope from "@/components/BrandScope";
import { staffMetadata } from "@/lib/staffMetadata";
import { getOfficeContext } from "@/lib/tenant";

export const metadata = staffMetadata;

/**
 * Printable pages (receipts, reports) for admins AND dispatchers.
 *
 * They live outside /admin (admins only) and /dispatch (which wraps every page
 * in the dispatch menu), so either role can open them and nothing but the
 * document itself is printed. They show the staff member's own company, and
 * the database only ever hands them that company's bookings.
 */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  const office = await getOfficeContext();
  if (!office) redirect("/login");
  return (
    <BrandScope companyId={office.company.id}>
      <div className="min-h-screen bg-gray-100 print:bg-white">{children}</div>
    </BrandScope>
  );
}
