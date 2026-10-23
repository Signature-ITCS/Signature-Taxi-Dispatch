import { NextResponse } from "next/server";
import { getOfficeContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenantDb";
import { clearSettingsCache } from "@/lib/settings";
import { clearBrandCache } from "@/lib/companyBrand";
import { COMPANY_SECRETS, secretStatus, setSecret } from "@/lib/secrets";
import { encryptionConfigured } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A company's own settings (Admin → Settings). Admins of that company only.
 *
 * GET returns everything the page shows — except secret values: for keys and
 * passwords it only says whether each is set, and its last 4 characters.
 * POST saves the sections that were sent. A secret sent as "" is removed; a
 * secret not sent at all is left as it is.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

type Json = Record<string, unknown>;

async function readSettings(companyId: string): Promise<Record<string, Json>> {
  const { data } = await tenantDb(companyId)
    .from("app_settings")
    .select("key, value")
    .in("key", ["company", "branding", "notifications", "payments", "booking"]);
  return Object.fromEntries(((data ?? []) as { key: string; value: Json }[]).map((r) => [r.key, r.value ?? {}]));
}

export async function GET(req: Request) {
  const office = await getOfficeContext({ adminOnly: true });
  if (!office) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const companyId = office.company.id;

  const db = tenantDb(companyId);
  const [s, secrets, { data: staff }, { data: usage }] = await Promise.all([
    readSettings(companyId),
    secretStatus(companyId),
    db.from("profiles").select("email").in("role", ["admin", "dispatcher"]).eq("is_active", true),
    createAdminClient().rpc("company_usage", { p_company: companyId }),
  ]);
  const n = s.notifications ?? {};
  const c = s.company ?? {};
  const br = s.branding ?? {};

  // Booking-alert recipients. Until the admin saves a list, alerts go to every
  // active staff login — surface those as the starting list.
  const savedList = Array.isArray(n.booking_alert_emails) ? (n.booking_alert_emails as string[]) : null;
  const staffEmails = ((staff ?? []) as { email: string | null }[])
    .map((x) => x.email?.trim().toLowerCase())
    .filter((e): e is string => !!e);

  const origin = (process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin).replace(/\/$/, "");
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  return NextResponse.json({
    ok: true,
    company: { id: companyId, slug: office.company.slug, status: office.company.status },
    config: {
      name: str(c.name) || office.company.name,
      legal_name: str(c.legal_name),
      address: str(c.address),
      phone: str(c.phone),
      email: str(c.email),
      website: str(c.website),
      timezone: str(c.timezone) || "Europe/London",
      primary_color: str(br.primary_color) || "#1d4ed8",
      dark_color: str(br.dark_color) || "#0f172a",
      logo_url: str(br.logo_url),
      email_from: str(n.email_from),
      sms_sender: str(n.sms_sender),
      reply_to: str(n.reply_to),
      booking_alert_emails: savedList ?? Array.from(new Set(staffEmails)),
      alert_emails_saved: savedList !== null,
      card_enabled: (s.payments ?? {}).card_enabled === true,
    },
    secrets,
    encryption_ready: encryptionConfigured(),
    stripe_webhook_url: `${origin}/api/webhooks/stripe/${companyId}`,
    booking_url: `${origin}/${office.company.slug}`,
    staff_login_url: `${origin}/${office.company.slug}/login`,
    driver_login_url: `${origin}/${office.company.slug}/driver`,
    usage,
  });
}

/** Merge `patch` into one settings key of this company. */
async function merge(companyId: string, key: string, patch: Json) {
  if (Object.keys(patch).length === 0) return;
  const db = tenantDb(companyId);
  const { data } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
  const value = { ...((data?.value as Json) ?? {}), ...patch };
  const { error } = await db.from("app_settings").upsert({ key, value }, { onConflict: "company_id,key" });
  if (error) throw error;
}

const SECRET_RULES: Record<string, RegExp> = {
  stripe_secret_key: /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/,
  stripe_webhook_secret: /^whsec_[A-Za-z0-9+/=]{10,}$/,
  resend_api_key: /^re_[A-Za-z0-9_]{10,}$/,
  cosmic_username: /^.{1,120}$/,
  cosmic_password: /^.{1,200}$/,
};

export async function POST(req: Request) {
  const office = await getOfficeContext({ adminOnly: true });
  if (!office) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const companyId = office.company.id;
  const me = office.profile;
  const b = (await req.json().catch(() => ({}))) as Json;
  const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

  try {
    // Company details (shown on receipts, emails and the booking site).
    const company: Json = {};
    for (const f of ["name", "legal_name", "address", "phone", "email", "website", "timezone"] as const) {
      const v = text(b[f], f === "address" ? 400 : 200);
      if (v !== undefined) company[f] = v;
    }
    if (company.name === "") delete company.name;
    await merge(companyId, "company", company);

    // Branding.
    const branding: Json = {};
    if (typeof b.primary_color === "string" && HEX.test(b.primary_color)) branding.primary_color = b.primary_color.toLowerCase();
    if (typeof b.dark_color === "string" && HEX.test(b.dark_color)) branding.dark_color = b.dark_color.toLowerCase();
    if (b.logo_url === "") branding.logo_url = "";
    await merge(companyId, "branding", branding);

    // Email and SMS.
    const notif: Json = {};
    if (typeof b.email_from === "string") {
      const v = b.email_from.trim();
      if (v && !EMAIL_RE.test(v.replace(/^.*<([^>]+)>.*$/, "$1"))) {
        return NextResponse.json({ ok: false, error: "invalid_email_from" });
      }
      notif.email_from = v;
    }
    if (typeof b.sms_sender === "string") notif.sms_sender = b.sms_sender.replace(/[^A-Za-z0-9]/g, "").slice(0, 11);
    // Where customer replies go. Kept as typed, minus anything that isn't an address.
    if (typeof b.reply_to === "string") {
      notif.reply_to = b.reply_to
        .split(/[,;\s]+/)
        .map((e: string) => e.trim().toLowerCase())
        .filter((e: string) => EMAIL_RE.test(e))
        .slice(0, 5)
        .join(", ");
    }
    // Exact list of who gets the "New booking" alert. An empty list is valid
    // (nobody). Invalid / duplicate addresses are dropped rather than rejected.
    if (Array.isArray(b.booking_alert_emails)) {
      notif.booking_alert_emails = Array.from(
        new Set(
          (b.booking_alert_emails as unknown[])
            .map((e) => String(e ?? "").trim().toLowerCase())
            .filter((e) => e && EMAIL_RE.test(e))
        )
      ).slice(0, 50);
    }
    await merge(companyId, "notifications", notif);

    // Card payments on/off.
    if (typeof b.card_enabled === "boolean") await merge(companyId, "payments", { card_enabled: b.card_enabled });

    // Keys and passwords: write-only, encrypted.
    const secrets = (b.secrets ?? {}) as Json;
    const changed: string[] = [];
    for (const name of COMPANY_SECRETS) {
      const v = secrets[name];
      if (typeof v !== "string") continue;
      if (v.trim() && !SECRET_RULES[name].test(v.trim())) {
        return NextResponse.json({ ok: false, error: `invalid_${name}` });
      }
      if (!encryptionConfigured()) return NextResponse.json({ ok: false, error: "encryption_not_configured" });
      await setSecret(companyId, name, v, me.id);
      changed.push(v.trim() ? `${name} saved` : `${name} removed`);
    }

    clearSettingsCache();
    clearBrandCache(companyId);
    await tenantDb(companyId)
      .from("activity_logs")
      .insert({
        actor_id: me.id,
        actor_name: me.full_name,
        actor_role: me.role,
        action: "settings_updated",
        // Never the values — only which keys changed.
        description: changed.length ? `Updated settings (${changed.join(", ")})` : "Updated settings",
      });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[settings] save failed", err);
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 500 });
  }
}
