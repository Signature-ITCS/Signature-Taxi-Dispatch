import BrandScope from "@/components/BrandScope";
import { createAdminClient } from "@/lib/supabase/admin";
import CompleteClient from "./CompleteClient";

/** Back from Stripe: the booking is finished here, in the colours of the company paid. */
export default async function BookingCompletePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sessionId = (await searchParams).session_id;
  const { data } = sessionId
    ? await createAdminClient().from("checkout_drafts").select("company_id").eq("session_id", sessionId).maybeSingle()
    : { data: null };
  return (
    <BrandScope companyId={(data?.company_id as string) ?? null}>
      <CompleteClient />
    </BrandScope>
  );
}
