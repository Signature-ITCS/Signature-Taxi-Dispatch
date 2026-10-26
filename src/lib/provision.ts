import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { accountReadyEmail, ownerNoticeEmail } from "@/lib/emailTemplates";
import { getPlatformBrand } from "@/lib/companyBrand";
import { audit, type CompanyStatus } from "@/lib/tenant";

/**
 * Creating a company account. Server-only; platform code (signup, master
 * dashboard), never reachable by a company.
 */

/** Addresses a company slug must never take (they are pages of their own). */
const RESERVED = new Set([
  "admin", "api", "account", "auth", "book", "booking", "dispatch", "driver", "embed", "install",
  "login", "master", "print", "pricing", "signup", "staff", "track", "www", "app", "help", "support",
  "documentation", "docs", "signup-done", "set-password", "forgot",
]);

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36) || "company"
  );
}

/** A free slug based on `wanted` (adds -2, -3… when taken or reserved). */
export async function freeSlug(wanted: string): Promise<string> {
  const admin = createAdminClient();
  const base = slugify(wanted);
  for (let i = 1; i < 200; i++) {
    const s = i === 1 ? base : `${base}-${i}`;
    if (RESERVED.has(s) || s.length < 2) continue;
    const [{ data: c }, { data: w }] = await Promise.all([
      admin.from("companies").select("id").eq("slug", s).maybeSingle(),
      admin.from("websites").select("id").eq("slug", s).maybeSingle(),
    ]);
    if (!c && !w) return s;
  }
  throw new Error("No free address for this company name");
}

/** Is this the email of a platform owner? (Owners must never become a company's login.) */
export async function isOwnerEmail(email: string): Promise<boolean> {
  const admin = createAdminClient();
  const clean = email.trim().toLowerCase();
  const { data: owners } = await admin.from("platform_admins").select("user_id").limit(20);
  for (const o of owners ?? []) {
    const { data } = await admin.auth.admin.getUserById(o.user_id as string);
    if (data.user?.email?.toLowerCase() === clean) return true;
  }
  return false;
}

export const siteOrigin = (fallback?: string) => (process.env.NEXT_PUBLIC_SITE_URL || fallback || "").replace(/\/$/, "");

/**
 * Email a one-time "choose your password" link (new account, or forgotten
 * password). The link is our own /auth/confirm, which signs the user in from
 * the token and opens /auth/set-password.
 */
export async function sendPasswordLink(opts: {
  email: string;
  fullName: string;
  companyName: string;
  planName?: string | null;
  kind: "welcome" | "reset";
  origin: string;
  /** The company's address (its staff sign-in is /<slug>/login). */
  slug?: string | null;
}): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email: opts.email });
  const hashed = data?.properties?.hashed_token;
  if (error || !hashed) {
    console.error("[auth] could not create password link", error?.message);
    return false;
  }
  const url = `${opts.origin}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=recovery&next=${encodeURIComponent("/auth/set-password")}`;
  const mail = accountReadyEmail(
    {
      fullName: opts.fullName,
      companyName: opts.companyName,
      planName: opts.planName ?? null,
      setPasswordUrl: url,
      loginUrl: opts.slug ? `${opts.origin}/${opts.slug}/login` : `${opts.origin}/login`,
      kind: opts.kind,
    },
    await getPlatformBrand()
  );
  return sendEmail({ companyId: null, to: opts.email, subject: mail.subject, html: mail.html });
}

export interface ProvisionInput {
  companyName: string;
  ownerName: string;
  ownerEmail: string;
  /** Mobile / WhatsApp number, for sending payment links. */
  ownerPhone?: string | null;
  planId: string;
  status: CompanyStatus;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
  /** Where it came from: the public sign-up page or the master dashboard. */
  via?: "signup" | "master";
  origin: string;
  actor?: { id: string | null; email: string | null };
}

export type ProvisionResult =
  | { ok: true; companyId: string; slug: string; emailed: boolean }
  | { ok: false; error: string };

/**
 * Create a company, its starting data and its owner's admin login, then email
 * the owner a link to choose a password. If anything fails, what was created is
 * removed again. Its first invoice is added straight away when it is due within
 * a week (see db/2026-10-27_manual_billing.sql).
 */
export async function provisionCompany(p: ProvisionInput): Promise<ProvisionResult> {
  const admin = createAdminClient();
  const email = p.ownerEmail.trim().toLowerCase();
  const name = p.companyName.trim().slice(0, 120);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "invalid_details" };

  const { data: plan } = await admin.from("plans").select("id, name").eq("id", p.planId).maybeSingle();
  if (!plan) return { ok: false, error: "unknown_plan" };

  // One login per email address across the platform.
  const { data: taken } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (taken || (await isOwnerEmail(email))) return { ok: false, error: "email_in_use" };

  const slug = await freeSlug(name);
  const { data: company, error: cErr } = await admin
    .from("companies")
    .insert({
      name,
      slug,
      status: p.status,
      plan_id: plan.id,
      owner_email: email,
      owner_phone: p.ownerPhone?.trim() || null,
      trial_ends_at: p.trialEndsAt ?? null,
      current_period_end: p.currentPeriodEnd ?? null,
    })
    .select("id")
    .single();
  if (cErr || !company) {
    console.error("[provision] company insert failed", cErr);
    return { ok: false, error: "create_failed" };
  }
  const companyId = company.id as string;
  const undo = async () => {
    await admin.from("companies").delete().eq("id", companyId);
  };

  const { error: seedErr } = await admin.rpc("seed_company", { p_company: companyId });
  if (seedErr) {
    console.error("[provision] seed failed", seedErr);
    await undo();
    return { ok: false, error: "create_failed" };
  }

  // The owner's login. An auth user without a profile (e.g. from a cancelled
  // trial) is reused.
  let userId: string | null = null;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: p.ownerName },
  });
  if (created.data.user) {
    userId = created.data.user.id;
  } else {
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = list?.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
  }
  if (!userId) {
    console.error("[provision] could not create login", created.error?.message);
    await undo();
    return { ok: false, error: "login_failed" };
  }

  const { error: pErr } = await admin.from("profiles").insert({
    id: userId,
    company_id: companyId,
    full_name: p.ownerName.trim().slice(0, 120) || email,
    email,
    role: "admin",
  });
  if (pErr) {
    console.error("[provision] profile insert failed", pErr);
    await undo();
    return { ok: false, error: "login_failed" };
  }

  // Alerts and customer replies go to the owner until they change it in Settings.
  await admin
    .from("app_settings")
    .update({ value: { email_from: "", sms_sender: "", reply_to: email, booking_alert_emails: [email] } })
    .eq("company_id", companyId)
    .eq("key", "notifications");

  const emailed = await sendPasswordLink({
    email,
    fullName: p.ownerName,
    companyName: name,
    planName: plan.name as string,
    kind: "welcome",
    origin: p.origin,
    slug,
  });

  await audit("company_created", {
    actorId: p.actor?.id ?? null,
    actorEmail: p.actor?.email ?? email,
    companyId,
    detail: { name, slug, plan: plan.name, status: p.status, via: p.via ?? "master" },
  });
  // Its first invoice, if due within a week (no trial) — so it shows in Master → Billing now.
  const { error: genErr } = await admin.rpc("platform_generate_invoices", { p_days_ahead: 7 });
  if (genErr) console.error("[provision] invoice generation failed", genErr.message);
  await notifyOwner(
    `New company: ${name}`,
    [
      ["Company", name],
      ["Owner", `${p.ownerName} <${email}>${p.ownerPhone ? ` · ${p.ownerPhone}` : ""}`],
      ["Plan", String(plan.name)],
      ["Status", p.status],
      ["Company address", `${p.origin}/${slug}`],
      ["Billing", p.status === "trialing" && p.trialEndsAt ? `Free trial until ${new Date(p.trialEndsAt).toLocaleDateString("en-GB")} — the first invoice appears in Master → Billing a week before` : "First invoice is in Master → Billing — send them the payment link"],
    ],
    `${p.origin}/master/companies`
  );

  return { ok: true, companyId, slug, emailed };
}

/** Email the platform owner's support address (master dashboard → Settings). */
export async function notifyOwner(title: string, lines: [string, string][], actionUrl?: string): Promise<void> {
  try {
    const { data } = await createAdminClient().from("platform_settings").select("value").eq("key", "platform").maybeSingle();
    const to = ((data?.value as { support_email?: string } | null)?.support_email ?? "").trim();
    if (!to) return;
    const mail = ownerNoticeEmail({ title, lines, actionUrl, actionLabel: "Open the master dashboard" }, await getPlatformBrand());
    await sendEmail({ companyId: null, to, subject: mail.subject, html: mail.html });
  } catch {
    /* a notice must never break what triggered it */
  }
}
