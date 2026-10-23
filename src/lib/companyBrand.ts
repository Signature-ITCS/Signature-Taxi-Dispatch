import { createAdminClient } from "@/lib/supabase/admin";

/**
 * How a company presents itself: name, colours, logo and contact details —
 * set in its own Admin → Settings → Branding. Every screen, email, SMS and
 * receipt reads it from here. Server-only.
 */
export interface CompanyBrand {
  companyId: string | null;
  slug: string | null;
  name: string;
  legalName: string;
  /** SMS sender ID: max 11 letters/digits. */
  smsSender: string;
  primary: string;
  dark: string;
  logoUrl: string | null;
  contact: { address: string; phone: string; email: string; website: string };
}

import { DEFAULT_DARK, DEFAULT_PRIMARY } from "@/lib/brandColors";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Up to 11 letters/digits — what UK networks accept as a text sender. */
export function senderFromName(name: string): string {
  const s = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 11);
  return s.length >= 3 ? s : "Taxi";
}

export async function getPlatformName(): Promise<string> {
  try {
    const { data } = await createAdminClient().from("platform_settings").select("value").eq("key", "platform").maybeSingle();
    const n = (data?.value as { name?: string } | null)?.name?.trim();
    return n || "Dispatch Platform";
  } catch {
    return "Dispatch Platform";
  }
}

/** The platform itself, for pages that belong to no company (sign-in, pricing). */
export async function getPlatformBrand(): Promise<CompanyBrand> {
  const name = await getPlatformName();
  return {
    companyId: null,
    slug: null,
    name,
    legalName: name,
    smsSender: senderFromName(name),
    primary: DEFAULT_PRIMARY,
    dark: DEFAULT_DARK,
    logoUrl: null,
    contact: { address: "", phone: "", email: "", website: "" },
  };
}

type CacheEntry = { v: CompanyBrand; exp: number };
const cache = new Map<string, CacheEntry>();
const TTL = 30_000;

export async function getCompanyBrand(companyId: string | null | undefined): Promise<CompanyBrand> {
  if (!companyId) return getPlatformBrand();
  const hit = cache.get(companyId);
  if (hit && hit.exp > Date.now()) return hit.v;

  const admin = createAdminClient();
  const [{ data: company }, { data: settings }] = await Promise.all([
    admin.from("companies").select("name, slug").eq("id", companyId).maybeSingle(),
    admin.from("app_settings").select("key, value").eq("company_id", companyId).in("key", ["branding", "company", "notifications"]),
  ]);
  if (!company) return getPlatformBrand();

  const byKey = Object.fromEntries(((settings ?? []) as { key: string; value: Record<string, unknown> }[]).map((r) => [r.key, r.value ?? {}]));
  const branding = byKey.branding ?? {};
  const co = byKey.company ?? {};
  const notif = byKey.notifications ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const name = str(co.name) || (company.name as string);
  const brand: CompanyBrand = {
    companyId,
    slug: company.slug as string,
    name,
    legalName: str(co.legal_name) || name,
    smsSender: senderFromName(str(notif.sms_sender) || name),
    primary: HEX.test(str(branding.primary_color)) ? str(branding.primary_color) : DEFAULT_PRIMARY,
    dark: HEX.test(str(branding.dark_color)) ? str(branding.dark_color) : DEFAULT_DARK,
    logoUrl: str(branding.logo_url) || null,
    contact: {
      address: str(co.address),
      phone: str(co.phone),
      email: str(co.email),
      website: str(co.website),
    },
  };
  cache.set(companyId, { v: brand, exp: Date.now() + TTL });
  return brand;
}

export function clearBrandCache(companyId?: string) {
  if (companyId) cache.delete(companyId);
  else cache.clear();
}
