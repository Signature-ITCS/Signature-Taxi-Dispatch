import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * Which company a request belongs to. Server-only.
 *
 * Every company-owned row carries company_id, and the database refuses to let
 * signed-in users see other companies' rows. Server code that uses the
 * service-role key (which bypasses those rules) must instead scope every query
 * itself — always through a company id obtained here, never one sent by a
 * browser.
 */

export type CompanyStatus = "pending" | "trialing" | "active" | "past_due" | "suspended" | "cancelled";

export interface Company {
  id: string;
  name: string;
  slug: string;
  status: CompanyStatus;
  plan_id: string | null;
  owner_email: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  custom_domain: string | null;
  support_access_until: string | null;
  created_at: string;
}

/** Companies that may use the system (past_due is a grace period). */
export const OPEN_STATUSES: CompanyStatus[] = ["trialing", "active", "past_due"];
export const companyIsOpen = (c: Pick<Company, "status"> | null | undefined) => !!c && OPEN_STATUSES.includes(c.status);

const COMPANY_COLUMNS =
  "id, name, slug, status, plan_id, owner_email, trial_ends_at, current_period_end, stripe_customer_id, stripe_subscription_id, custom_domain, support_access_until, created_at";

export async function getCompany(id: string): Promise<Company | null> {
  const { data } = await createAdminClient().from("companies").select(COMPANY_COLUMNS).eq("id", id).maybeSingle();
  return (data as Company) ?? null;
}

export async function getCompanyBySlug(slug: string): Promise<Company | null> {
  const { data } = await createAdminClient()
    .from("companies")
    .select(COMPANY_COLUMNS)
    .eq("slug", slug.trim().toLowerCase())
    .maybeSingle();
  return (data as Company) ?? null;
}

export async function getCompanyByDomain(host: string): Promise<Company | null> {
  const h = host.trim().toLowerCase().replace(/:\d+$/, "");
  if (!h) return null;
  const { data } = await createAdminClient().from("companies").select(COMPANY_COLUMNS).eq("custom_domain", h).maybeSingle();
  return (data as Company) ?? null;
}

export interface SiteRef {
  id: string;
  slug: string;
  name: string;
  api_key: string;
  company_id: string;
}

/** An active booking website of an open company, by its slug (as in /book/<slug>). */
export async function resolveWebsite(slug: string | null | undefined): Promise<SiteRef | null> {
  const s = String(slug ?? "").trim().toLowerCase();
  if (!s) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("websites")
    .select("id, slug, name, api_key, company_id, companies!inner(status)")
    .eq("slug", s)
    .eq("is_active", true)
    .maybeSingle();
  const row = data as (SiteRef & { companies: { status: CompanyStatus } }) | null;
  if (!row || !companyIsOpen(row.companies)) return null;
  return { id: row.id, slug: row.slug, name: row.name, api_key: row.api_key, company_id: row.company_id };
}

/**
 * A public booking address: a website slug, or else a company slug (which
 * then means that company's main website). Only for open companies.
 */
export async function resolveBookingSite(slug: string | null | undefined): Promise<SiteRef | null> {
  const site = await resolveWebsite(slug);
  if (site) return site;
  const company = slug ? await getCompanyBySlug(slug) : null;
  return company && companyIsOpen(company) ? companyWebsite(company.id) : null;
}

/** A company's main booking website (its oldest active one). */
export async function companyWebsite(companyId: string): Promise<SiteRef | null> {
  const { data } = await createAdminClient()
    .from("websites")
    .select("id, slug, name, api_key, company_id")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as SiteRef) ?? null;
}

/**
 * The website a booking request should use. Staff always book into their own
 * company — whatever site the page sent — so a dispatcher can never create or
 * re-price a booking in another company.
 */
export async function websiteForRequest(site: string | null | undefined, staffCompanyId: string | null): Promise<SiteRef | null> {
  if (staffCompanyId) {
    const requested = await resolveWebsite(site);
    if (requested && requested.company_id === staffCompanyId) return requested;
    return companyWebsite(staffCompanyId);
  }
  return resolveWebsite(site);
}

export async function companyIdForBooking(bookingId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("bookings").select("company_id").eq("id", bookingId).maybeSingle();
  return (data?.company_id as string) ?? null;
}

export type StaffProfile = Profile & { company_id: string };

export interface StaffContext {
  userId: string;
  email: string | null;
  profile: StaffProfile;
  company: Company;
}

/**
 * The signed-in user's profile and company, or null when nobody is signed in.
 * `company` is returned even when it is suspended — callers decide what to show.
 */
export async function getStaffContext(): Promise<StaffContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile?.company_id) return null;
  const company = await getCompany(profile.company_id as string);
  if (!company) return null;
  return { userId: user.id, email: user.email ?? null, profile: profile as StaffProfile, company };
}

/** Signed-in office staff (admin/dispatcher) of an open company, or null. */
export async function getOfficeContext(opts: { adminOnly?: boolean } = {}): Promise<StaffContext | null> {
  const ctx = await getStaffContext();
  if (!ctx || !ctx.profile.is_active || !companyIsOpen(ctx.company)) return null;
  const ok = opts.adminOnly ? ctx.profile.role === "admin" : ctx.profile.role === "admin" || ctx.profile.role === "dispatcher";
  return ok ? ctx : null;
}

/** The signed-in platform owner, or null. */
export async function getPlatformAdmin(): Promise<{ userId: string; email: string | null } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await createAdminClient().from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  return data ? { userId: user.id, email: user.email ?? null } : null;
}

/** Record a sensitive action in the platform audit log (best-effort). */
export async function audit(
  action: string,
  opts: { actorId?: string | null; actorEmail?: string | null; companyId?: string | null; detail?: unknown } = {}
): Promise<void> {
  try {
    await createAdminClient()
      .from("platform_audit")
      .insert({
        action,
        actor_id: opts.actorId ?? null,
        actor_email: opts.actorEmail ?? null,
        company_id: opts.companyId ?? null,
        detail: opts.detail ?? null,
      });
  } catch {
    /* never block the action on its log */
  }
}
