import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CompanyStatus } from "@/lib/tenant";

/**
 * Companies' subscriptions to the platform (paid to the platform owner's
 * Stripe). Server-only.
 */

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_monthly: number;
  currency: string;
  max_drivers: number | null;
  max_staff: number | null;
  max_bookings_month: number | null;
  backups_included: boolean;
  features: string[];
  trial_days: number;
  is_public: boolean;
  is_active: boolean;
  sort_order: number;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
}

export async function listPlans(opts: { publicOnly?: boolean } = {}): Promise<Plan[]> {
  let q = createAdminClient().from("plans").select("*").order("sort_order");
  if (opts.publicOnly) q = q.eq("is_public", true).eq("is_active", true);
  const { data } = await q;
  return (data ?? []) as Plan[];
}

/** Stripe's subscription status → the company's status. */
export function statusFromStripe(s: Stripe.Subscription.Status): CompanyStatus {
  switch (s) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "past_due";
    case "paused":
      return "suspended";
    default:
      return "cancelled";
  }
}

const iso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);

/** The fields a subscription sets on its company row. */
export function companyFieldsFromSubscription(sub: Stripe.Subscription) {
  const item = sub.items?.data?.[0];
  return {
    status: statusFromStripe(sub.status),
    trial_ends_at: iso(sub.trial_end),
    current_period_end: iso(item?.current_period_end ?? null),
    stripe_price_id: item?.price?.id ?? null,
  };
}
