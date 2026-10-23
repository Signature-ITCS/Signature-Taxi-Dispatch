/**
 * SMS sender via the Cosmic SMS REST API (Basic auth + XML body). Server-only.
 *
 * Each company uses its OWN Cosmic SMS account: username and API password saved
 * (encrypted) in Admin → Settings → SMS. The sender ID is its settings value,
 * else its name. Gracefully no-ops when the company hasn't set SMS up.
 * Best-effort — returns false, never throws.
 */
import { normalizeWhatsapp } from "./format";
import { getSecret } from "./secrets";
import { getCompanyBrand } from "./companyBrand";

async function credentials(companyId: string): Promise<{ user: string; pass: string } | null> {
  const [user, pass] = await Promise.all([getSecret(companyId, "cosmic_username"), getSecret(companyId, "cosmic_password")]);
  return user && pass ? { user, pass } : null;
}

export async function smsEnabled(companyId: string): Promise<boolean> {
  return (await credentials(companyId)) !== null;
}

function escapeXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function sendSms(companyId: string, to: string, message: string): Promise<boolean> {
  const creds = await credentials(companyId);
  if (!creds) return false;

  const mobile = normalizeWhatsapp(to); // -> 447... international form
  if (!mobile) return false;
  // Networks only deliver a text sender of up to 11 letters/digits.
  const sender = (await getCompanyBrand(companyId)).smsSender;

  const auth = Buffer.from(`${creds.user}:${creds.pass}`).toString("base64");
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<sendsms><sender>${escapeXml(sender)}</sender>` +
    `<message>${escapeXml(message)}</message>` +
    `<mobiles><mobile>${mobile}</mobile></mobiles></sendsms>`;

  try {
    const res = await fetch("https://api.cosmicsms.com/prod/rest/sms/send", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/xml" },
      body: xml,
    });
    return res.ok;
  } catch {
    return false;
  }
}
