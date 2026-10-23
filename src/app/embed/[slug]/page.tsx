import { notFound } from "next/navigation";
import BookingWidget from "@/components/booking/BookingWidget";
import BrandScope from "@/components/BrandScope";
import { resolveBookingSite } from "@/lib/tenant";
import { cardPaymentsEnabled } from "@/lib/paymentMethods";

export const metadata = {
  title: "Book a ride",
};

/** The booking widget a company embeds on its own website (Admin → Widgets). */
export default async function EmbedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await resolveBookingSite(slug);
  if (!site) notFound();
  return (
    <BrandScope companyId={site.company_id}>
      <BookingWidget site={site.slug} embed cardEnabled={await cardPaymentsEnabled(site.company_id)} />
    </BrandScope>
  );
}
