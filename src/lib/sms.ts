/**
 * SMS sender via the Cosmic SMS REST API (Basic auth + XML body).
 *
 * Username / API password come from COSMICSMS_* env vars (kept in .env / Vercel
 * — never in the DB or admin UI). The sender ID is admin-editable config
 * (app_settings), falling back to COSMICSMS_SENDER. Gracefully no-ops when
 * unconfigured. Best-effort — returns false, never throws.
 */
import { normalizeWhatsapp } from "./format";
import { getConfigValue } from "./settings";
import { BRAND } from "./brand";

export async function smsEnabled(): Promise<boolean> {
  return Boolean(process.env.COSMICSMS_USERNAME && process.env.COSMICSMS_API_PASSWORD);
}

function escapeXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Networks only deliver a text sender ID of up to 11 letters and digits — a
 * name like "CHEAP TRANSFERS" is rejected outright. Strip it down to
 * something that will be accepted, falling back to the brand's own.
 */
export function smsSenderId(configured: string | null | undefined): string {
  const cleaned = String(configured ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 11);
  return cleaned.length >= 3 ? cleaned : BRAND.smsSender;
}

export async function sendSms(to: string, message: string): Promise<boolean> {
  const user = process.env.COSMICSMS_USERNAME;
  const pass = process.env.COSMICSMS_API_PASSWORD;
  if (!user || !pass) return false;

  const mobile = normalizeWhatsapp(to); // -> 447... international form
  if (!mobile) return false;
  const sender = smsSenderId(
    await getConfigValue("notifications", "sms_sender", process.env.COSMICSMS_SENDER)
  );

  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
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
