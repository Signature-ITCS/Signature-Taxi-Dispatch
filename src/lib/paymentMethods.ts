import { getSetting } from "@/lib/settings";
import { stripeConfigured } from "@/lib/stripe";

/**
 * Is "pay by card" open to a company's customers right now? Server-only.
 *
 * Card payments are deliberately OFF until the company turns them on in
 * Admin → Settings → Card payments, AND has saved its Stripe key. While a
 * company runs on Stripe test keys a customer could complete a checkout and be
 * told "Paid by card" without a penny moving — off-by-default means that only
 * happens on purpose.
 *
 * The booking widget is told the answer by its page; /api/payment/checkout
 * checks it again, so a hand-crafted request can't start a checkout the page
 * didn't offer.
 */
export async function cardPaymentsEnabled(companyId: string): Promise<boolean> {
  const payments = await getSetting(companyId, "payments");
  if (payments?.card_enabled !== true) return false;
  return stripeConfigured(companyId);
}
