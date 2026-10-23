/**
 * Email sender via the Resend REST API (no SDK — plain fetch).
 *
 * The API key comes from RESEND_API_KEY in the environment (kept in .env /
 * Vercel — never in the DB or admin UI). The "from" address comes from
 * EMAIL_FROM in the environment first, then falls back to the admin-editable
 * config (app_settings), then to DEFAULT_FROM. Gracefully no-ops when no key
 * is configured, so the app works before email is set up.
 *
 * Replies: every email carries a Reply-To (Admin → Settings → "Customer replies
 * go to"), so a customer pressing Reply reaches the office inbox instead of the
 * sending address.
 */
import { getConfigValue } from "./settings";

const DEFAULT_FROM = "Cheap Transfers <onboarding@resend.dev>";

export async function emailEnabled(): Promise<boolean> {
  return Boolean(process.env.RESEND_API_KEY);
}

async function resolveFrom(): Promise<string> {
  const envFrom = process.env.EMAIL_FROM?.trim();
  if (envFrom) return envFrom;

  const dbFrom = (await getConfigValue("notifications", "email_from", undefined))?.trim();
  if (dbFrom) return dbFrom;

  return DEFAULT_FROM;
}

const EMAIL_RE = /^[^s@]+@[^s@]+.[^s@]+$/;

/** The office inbox(es) replies should reach — comma-separated in Settings. */
async function resolveReplyTo(): Promise<string[]> {
  const raw = (await getConfigValue("notifications", "reply_to", undefined)) ?? "";
  return raw
    .split(/[,;s]+/)
    .map((e) => e.trim())
    .filter((e) => EMAIL_RE.test(e));
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;

  const to = (Array.isArray(opts.to) ? opts.to : [opts.to]).filter(Boolean);
  if (to.length === 0) return false;

  const from = await resolveFrom();
  const replyTo = opts.replyTo ? [opts.replyTo] : await resolveReplyTo();

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: opts.subject,
        html: opts.html,
        ...(replyTo.length ? { reply_to: replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[email] Resend error ${res.status} (from: ${from}):`, detail);
    }

    return res.ok;
  } catch (err) {
    console.error("[email] Failed to reach Resend:", err);
    return false;
  }
}
