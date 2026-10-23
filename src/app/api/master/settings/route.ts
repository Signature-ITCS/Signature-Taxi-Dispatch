import { NextResponse } from "next/server";
import { getPlatformAdmin, audit } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { PLATFORM_SECRETS, secretStatus, setSecret } from "@/lib/secrets";
import { encryptionConfigured, encryptionProblem } from "@/lib/crypto";
import { getServices } from "@/lib/services";
import { siteOrigin } from "@/lib/provision";

/**
 * Platform settings (platform owner): name, support and sender addresses, paid
 * services, and the platform's own keys (Stripe for subscriptions, Resend for
 * its emails) — keys write-only, as everywhere.
 */
export async function GET(req: Request) {
  if (!(await getPlatformAdmin())) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const { data } = await createAdminClient().from("platform_settings").select("value").eq("key", "platform").maybeSingle();
  const p = (data?.value ?? {}) as Record<string, string>;
  const origin = siteOrigin(new URL(req.url).origin);
  return NextResponse.json({
    ok: true,
    platform: { name: p.name ?? "", support_email: p.support_email ?? "", from_email: p.from_email ?? "" },
    services: await getServices(),
    secrets: await secretStatus(null),
    encryption_ready: encryptionConfigured(),
    encryption_problem: encryptionProblem(),
    env_fallbacks: {
      stripe_secret_key: !!process.env.STRIPE_SECRET_KEY,
      stripe_webhook_secret: !!process.env.STRIPE_WEBHOOK_SECRET,
      resend_api_key: !!process.env.RESEND_API_KEY,
    },
    stripe_webhook_url: `${origin}/api/platform/stripe-webhook`,
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RULES: Record<string, RegExp> = {
  stripe_secret_key: /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/,
  stripe_webhook_secret: /^whsec_[A-Za-z0-9+/=]{10,}$/,
  resend_api_key: /^re_[A-Za-z0-9_]{10,}$/,
};

export async function POST(req: Request) {
  const owner = await getPlatformAdmin();
  if (!owner) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const admin = createAdminClient();
  const changed: string[] = [];

  if (b.platform && typeof b.platform === "object") {
    const p = b.platform as Record<string, unknown>;
    const { data } = await admin.from("platform_settings").select("value").eq("key", "platform").maybeSingle();
    const value = { ...((data?.value as Record<string, unknown>) ?? {}) };
    if (typeof p.name === "string" && p.name.trim()) value.name = p.name.trim().slice(0, 60);
    for (const k of ["support_email", "from_email"]) {
      if (typeof p[k] === "string") {
        const e = (p[k] as string).trim().toLowerCase();
        if (e && !EMAIL_RE.test(e)) return NextResponse.json({ ok: false, error: `invalid_${k}` });
        value[k] = e;
      }
    }
    await admin.from("platform_settings").upsert({ key: "platform", value, updated_at: new Date().toISOString() });
    changed.push("platform details");
  }

  if (b.services && typeof b.services === "object") {
    const s = b.services as Record<string, unknown>;
    const packages = (Array.isArray(s.setup_packages) ? s.setup_packages : [])
      .map((x) => x as Record<string, unknown>)
      .map((x) => ({
        code: String(x.code ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30),
        name: String(x.name ?? "").trim().slice(0, 60),
        price: Math.max(0, Math.round(Number(x.price) || 0)),
        description: String(x.description ?? "").trim().slice(0, 300),
      }))
      .filter((x) => x.code && x.name)
      .slice(0, 8);
    await admin.from("platform_settings").upsert({
      key: "services",
      value: { setup_packages: packages, restore_price: Math.max(0, Math.round(Number(s.restore_price) || 0)) },
      updated_at: new Date().toISOString(),
    });
    changed.push("services");
  }

  const secrets = (b.secrets ?? {}) as Record<string, unknown>;
  for (const name of PLATFORM_SECRETS) {
    const v = secrets[name];
    if (typeof v !== "string") continue;
    if (v.trim() && !RULES[name].test(v.trim())) return NextResponse.json({ ok: false, error: `invalid_${name}` });
    if (!encryptionConfigured()) return NextResponse.json({ ok: false, error: "encryption_not_configured" });
    await setSecret(null, name, v, owner.userId);
    changed.push(v.trim() ? `${name} saved` : `${name} removed`);
  }

  // Which settings changed — never the values.
  await audit("platform_settings_updated", { actorId: owner.userId, actorEmail: owner.email, detail: { changed } });
  return NextResponse.json({ ok: true });
}
