/**
 * Email sender via the Resend REST API (no SDK — plain fetch). Server-only.
 *
 * Which account sends:
 *  - a company's own Resend key (Admin → Settings → Email), from its own
 *    address on its own verified domain; otherwise
 *  - the platform's Resend (master dashboard, or RESEND_API_KEY), from the
 *    platform's address but showing the company's name.
 * Platform emails (welcome, set-password, billing) pass companyId null.
 *
 * Replies: a company email carries its Reply-To (Settings → "Customer replies
 * go to"), so a customer pressing Reply reaches that office's inbox.
 * Gracefully no-ops when no key is available.
 */
import { getConfigValue } from "./settings";
import { getSecret } from "./secrets";
import { getCompanyBrand, getPlatformName } from "./companyBrand";
import { createAdminClient } from "./supabase/admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "Name <a@b.c>" or "a@b.c" → "a@b.c". */
function addressOf(from: string | undefined | null): string | null {
  const s = String(from ?? "").trim();
  const m = s.match(/<([^>]+)>/);
  const a = (m ? m[1] : s).trim();
  return EMAIL_RE.test(a) ? a : null;
}

const cleanName = (n: string) => n.replace(/[<>"\r\n]/g, "").trim();

async function platformTransport(): Promise<{ key: string; address: string } | null> {
  const key = (await getSecret(null, "resend_api_key")) ?? process.env.RESEND_API_KEY ?? null;
  if (!key) return null;
  let address: string | null = null;
  try {
    const { data } = await createAdminClient().from("platform_settings").select("value").eq("key", "platform").maybeSingle();
    address = addressOf((data?.value as { from_email?: string } | null)?.from_email);
  } catch {
    address = null;
  }
  address = address ?? addressOf(process.env.EMAIL_FROM) ?? "onboarding@resend.dev";
  return { key, address };
}

async function transport(companyId: string | null): Promise<{ key: string; from: string } | null> {
  if (companyId) {
    const brand = await getCompanyBrand(companyId);
    const ownKey = await getSecret(companyId, "resend_api_key");
    const ownFrom = addressOf(await getConfigValue(companyId, "notifications", "email_from"));
    if (ownKey && ownFrom) return { key: ownKey, from: `${cleanName(brand.name)} <${ownFrom}>` };
    const p = await platformTransport();
    return p ? { key: p.key, from: `${cleanName(brand.name)} <${p.address}>` } : null;
  }
  const p = await platformTransport();
  return p ? { key: p.key, from: `${cleanName(await getPlatformName())} <${p.address}>` } : null;
}

export async function emailEnabled(companyId: string | null): Promise<boolean> {
  return (await transport(companyId)) !== null;
}

/** The office inbox(es) a company's customer replies should reach. */
async function resolveReplyTo(companyId: string): Promise<string[]> {
  const raw = (await getConfigValue(companyId, "notifications", "reply_to")) ?? "";
  return raw
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter((e) => EMAIL_RE.test(e));
}

export async function sendEmail(opts: {
  companyId: string | null;
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<boolean> {
  const t = await transport(opts.companyId);
  if (!t) return false;

  const to = (Array.isArray(opts.to) ? opts.to : [opts.to]).filter(Boolean);
  if (to.length === 0) return false;

  const replyTo = opts.replyTo ? [opts.replyTo] : opts.companyId ? await resolveReplyTo(opts.companyId) : [];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${t.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: t.from,
        to,
        subject: opts.subject,
        html: opts.html,
        ...(replyTo.length ? { reply_to: replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[email] Resend error ${res.status} (from: ${t.from}):`, detail);
    }
    return res.ok;
  } catch (err) {
    console.error("[email] Failed to reach Resend:", err);
    return false;
  }
}
