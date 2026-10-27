import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOfficeContext, isPlatformOwnerUser, audit } from "@/lib/tenant";
import { twoFactorOf, officeTwoFactor } from "@/lib/twoFactor";
import { tenantDb } from "@/lib/tenantDb";
import { getPartnerByUser } from "@/lib/partners";

const HOME: Record<string, string> = { admin: "/admin", dispatcher: "/dispatch", driver: "/driver" };

/**
 * What the signed-in user still owes for two-factor sign-in, and where they go
 * afterwards. Used by the sign-in page (code step) and the Security page.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: true, signedIn: false });

  const owner = await isPlatformOwnerUser(user.id);
  const { data: profile } = await supabase.from("profiles").select("role, is_active, company_id, two_factor_due_at").eq("id", user.id).maybeSingle();
  let companyRequires = false;
  if (profile?.company_id) {
    const { data: c } = await createAdminClient().from("companies").select("require_2fa").eq("id", profile.company_id).maybeSingle();
    companyRequires = !!c?.require_2fa;
  }
  // A partner-network driver has no company login — their page is /partner.
  const partner = !owner && !profile ? await getPartnerByUser(user.id) : null;
  const role = (profile?.role as string | undefined) ?? (partner ? "partner" : null);
  const need = officeTwoFactor(role, companyRequires, (profile?.two_factor_due_at as string | null) ?? null);
  const tf = await twoFactorOf(supabase, owner || need.required, owner ? null : need.graceUntil);
  return NextResponse.json({
    ok: true,
    signedIn: true,
    email: user.email ?? null,
    owner,
    role,
    active: owner || !!profile?.is_active || (!!partner && partner.status !== "pending"),
    ...tf,
    companyRequires,
    canRequire: role === "admin",
    home: owner ? "/master" : partner ? "/partner" : (role && HOME[role]) || "/",
  });
}

/**
 * Company admins: require two-factor sign-in for all the company's office
 * staff (admins and dispatchers). Turning it on needs the admin's own
 * authenticator first, so they can't lock themselves out.
 */
export async function POST(req: Request) {
  const office = await getOfficeContext({ adminOnly: true });
  if (!office) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const { require } = (await req.json().catch(() => ({}))) as { require?: unknown };
  if (typeof require !== "boolean") return NextResponse.json({ ok: false, error: "bad_request" });
  if (require) {
    const tf = await twoFactorOf(await createClient(), false);
    if (!tf.verified) return NextResponse.json({ ok: false, error: "set_up_yours_first" });
  }
  const { error } = await createAdminClient().from("companies").update({ require_2fa: require, updated_at: new Date().toISOString() }).eq("id", office.company.id);
  if (error) return NextResponse.json({ ok: false, error: "save_failed" });
  await tenantDb(office.company.id).from("activity_logs").insert({
    actor_id: office.profile.id,
    actor_name: office.profile.full_name,
    actor_role: office.profile.role,
    action: "two_factor_policy",
    description: require ? "Required two-factor sign-in for office staff" : "Stopped requiring two-factor sign-in for office staff",
  });
  await audit("company_two_factor_policy", { actorId: office.userId, actorEmail: office.email, companyId: office.company.id, detail: { require } });
  return NextResponse.json({ ok: true });
}
