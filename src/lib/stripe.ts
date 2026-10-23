import Stripe from "stripe";

/**
 * Server-only Stripe client. The secret key comes from STRIPE_SECRET_KEY in the
 * environment (kept in .env / Vercel — never in the DB or admin UI).
 * Returns null when no key is configured (card payments disabled).
 * Never import into a client component.
 *
 * The API version is deliberately NOT passed: stripe-node pins its own version
 * (see node_modules/stripe/cjs/apiVersion.js), so the wire format always matches
 * the typings that ship with the installed SDK. Upgrade the version by upgrading
 * the package, not by hand-editing a date string here.
 */
let cached: Stripe | null = null;

export async function getStripe(): Promise<Stripe | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!cached) {
    cached = new Stripe(key, {
      // Retry transient network/5xx failures. stripe-node attaches an
      // idempotency key to its own retries, so this can't double-charge.
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: "Cheap Transfers Dispatch" },
    });
  }
  return cached;
}

/** True when card payments are switched on for this deployment. */
export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Webhook signing secret (Stripe Dashboard → Developers → Webhooks). */
export function webhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET || undefined;
}

/** Pence → pounds, as a 2dp number. Stripe always speaks minor units. */
export function fromMinor(pence: number | null | undefined): number {
  return Math.round(Number(pence ?? 0)) / 100;
}

/** Pounds → pence, rounded. */
export function toMinor(pounds: number): number {
  return Math.round(Number(pounds) * 100);
}
