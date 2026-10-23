import Stripe from "stripe";
import { getSecret } from "@/lib/secrets";

/**
 * Server-only Stripe clients. Never import into a client component.
 *
 *  - getStripe(companyId): the COMPANY's own Stripe account, from the key it
 *    saved in Admin → Settings → Card payments. Customers' fares go there.
 *  - getPlatformStripe(): the platform owner's Stripe account, from the master
 *    dashboard (or STRIPE_SECRET_KEY). Companies' subscriptions go there.
 *
 * Both return null when no key is set. The API version is deliberately NOT
 * passed: stripe-node pins its own, so the wire format always matches the
 * installed SDK's typings.
 */
const clients = new Map<string, Stripe>();

function client(key: string): Stripe {
  let c = clients.get(key);
  if (!c) {
    c = new Stripe(key, {
      // Retry transient network/5xx failures. stripe-node attaches an
      // idempotency key to its own retries, so this can't double-charge.
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: "Dispatch Platform" },
    });
    clients.set(key, c);
  }
  return c;
}

export async function getStripe(companyId: string): Promise<Stripe | null> {
  const key = await getSecret(companyId, "stripe_secret_key");
  return key ? client(key) : null;
}

export async function stripeConfigured(companyId: string): Promise<boolean> {
  return Boolean(await getSecret(companyId, "stripe_secret_key"));
}

/** The company's webhook signing secret (its Stripe Dashboard → Webhooks). */
export async function webhookSecret(companyId: string): Promise<string | undefined> {
  return (await getSecret(companyId, "stripe_webhook_secret")) ?? undefined;
}

export async function getPlatformStripe(): Promise<Stripe | null> {
  const key = (await getSecret(null, "stripe_secret_key")) ?? process.env.STRIPE_SECRET_KEY ?? null;
  return key ? client(key) : null;
}

export async function platformWebhookSecret(): Promise<string | undefined> {
  return (await getSecret(null, "stripe_webhook_secret")) ?? process.env.STRIPE_WEBHOOK_SECRET ?? undefined;
}

/** Pence → pounds, as a 2dp number. Stripe always speaks minor units. */
export function fromMinor(pence: number | null | undefined): number {
  return Math.round(Number(pence ?? 0)) / 100;
}

/** Pounds → pence, rounded. */
export function toMinor(pounds: number): number {
  return Math.round(Number(pounds) * 100);
}
