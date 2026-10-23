import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { sendPasswordLink, siteOrigin } from "@/lib/provision";
import { getPlatformName } from "@/lib/companyBrand";

/**
 * Email a password-reset link. Always answers the same, whether or not the
 * address has an account, so it can't be used to find out who has one.
 */
export async function POST(req: Request) {
  if (!rateLimit(`forgot:${clientIp(req)}`, 5, 15 * 60_000)) {
    return NextResponse.json({ ok: true });
  }
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  const clean = String(email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return NextResponse.json({ ok: true });
  if (!rateLimit(`forgot-email:${clean}`, 3, 60 * 60_000)) return NextResponse.json({ ok: true });

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
    if (profile || owner) {
      const companyName = (profile?.companies as { name?: string } | null)?.name ?? (await getPlatformName());
      await sendPasswordLink({
        email: clean,
        fullName: (profile?.full_name as string) || "",
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
