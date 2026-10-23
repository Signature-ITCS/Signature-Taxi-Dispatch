import BrandScope from "@/components/BrandScope";
import { createAdminClient } from "@/lib/supabase/admin";
import TrackClient from "./TrackClient";

/** The customer's live tracking page, in the colours of the company they booked. */
export default async function TrackPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const { data } = await createAdminClient()
    .from("bookings")
    .select("company_id")
    .eq("booking_number", decodeURIComponent(ref).trim())
    .maybeSingle();
  return (
    <BrandScope companyId={(data?.company_id as string) ?? null}>
      <TrackClient />
    </BrandScope>
  );
}
