import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimitShared } from "@/lib/rateLimit";
import { sendPasswordLink, siteOrigin } from "@/lib/provision";
import { getPlatformName } from "@/lib/companyBrand";
import { verifyTurnstile } from "@/lib/turnstile";

/**
 * Email a password-reset link. Always answers the same, whether or not the
 * address has an account, so it can't be used to find out who has one.
 */
export async function POST(req: Request) {
  if (!(await rateLimitShared(`forgot:${clientIp(req)}`, 5, 15 * 60_000))) {
    return NextResponse.json({ ok: true });
  }
  const { email, turnstile } = (await req.json().catch(() => ({}))) as { email?: string; turnstile?: string };
  if (!(await verifyTurnstile(turnstile, clientIp(req)))) return NextResponse.json({ ok: false, error: "robot_check" });
  const clean = String(email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return NextResponse.json({ ok: true });
  if (!(await rateLimitShared(`forgot-email:${clean}`, 3, 60 * 60_000))) return NextResponse.json({ ok: true });

  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, company_id, companies(name)")
      .eq("email", clean)
      .maybeSingle();
    // Not a company user? It may be a platform owner (they have no profile).
    let owner = false;
    if (!profile) {
      const { data: owners } = await admin.from("platform_admins").select("user_id").limit(20);
      for (const o of owners ?? []) {
        const { data: u } = await admin.auth.admin.getUserById(o.user_id as string);
        if (u.user?.email?.toLowerCase() === clean) owner = true;
      }
    }
    // …or a partner-network driver with a login.
    let partnerName: string | null = null;
    if (!profile && !owner) {
      const { data: partner } = await admin.from("partners").select("full_name, user_id").eq("email", clean).maybeSingle();
      if (partner?.user_id) partnerName = (partner.full_name as string) || "";
    }
    if (profile || owner || partnerName !== null) {
      const companyName = partnerName !== null ? "the partner network" : (profile?.companies as { name?: string } | null)?.name ?? (await getPlatformName());
      await sendPasswordLink({
        email: clean,
        fullName: (profile?.full_name as string) || partnerName || "",
        companyName,
        kind: "reset",
        origin: siteOrigin(new URL(req.url).origin),
      });
    }
  } catch (err) {
    console.error("[forgot] failed", err);
  }
  return NextResponse.json({ ok: true });
}
