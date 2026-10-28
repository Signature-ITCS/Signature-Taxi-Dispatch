/**
 * Cloudflare Turnstile, checked on the server. Server-only.
 *
 * Switched off (always passes) until TURNSTILE_SECRET_KEY is set in Vercel,
 * together with NEXT_PUBLIC_TURNSTILE_SITE_KEY for the widget. Once on, a
 * form without a valid, unused token is refused.
 */
export const turnstileOn = () => !!process.env.TURNSTILE_SECRET_KEY;

export async function verifyTurnstile(token: unknown, ip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (typeof token !== "string" || !token || token.length > 4096) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, cache: "no-store" });
    const d = (await r.json()) as { success?: boolean };
    return d.success === true;
  } catch (err) {
    // Cloudflare unreachable: let people through rather than lock everyone out
    // (the rate limits still apply).
    console.error("[turnstile] verify failed", err);
    return true;
  }
}
