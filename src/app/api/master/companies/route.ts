import { NextResponse } from "next/server";
import { getPlatformAdmin } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { provisionCompany, siteOrigin } from "@/lib/provision";

/** All companies with their plan and usage (platform owner only). */
export async function GET() {
  if (!(await getPlatformAdmin())) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const admin = createAdminClient();
  const { data } = await admin
    .from("companies")
    .select("id, name, slug, status, plan_id, owner_email, trial_ends_at, current_period_end, owner_phone, billing_paused, custom_domain, notes, created_at, plans(name)")
    .order("created_at", { ascending: false });
  const companies = await Promise.all(
    (data ?? []).map(async (c) => {
      const { data: usage } = await admin.rpc("company_usage", { p_company: c.id });
      return { ...c, usage };
    })
  );
  return NextResponse.json({ ok: true, companies });
}

/**
 * Create a company by hand (e.g. an existing client moving over, or a deal
 * agreed outside the website). Billed like every company — its invoices appear
 * in Master → Billing — unless billing is paused for it.
 */
export async function POST(req: Request) {
  const owner = await getPlatformAdmin();
  if (!owner) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const status = b.status === "trialing" ? "trialing" : "active";
  const trialDays = Math.min(Math.max(Number(b.trial_days) || 14, 1), 365);
  const result = await provisionCompany({
    companyName: String(b.company_name ?? ""),
    ownerName: String(b.owner_name ?? ""),
    ownerEmail: String(b.owner_email ?? ""),
    ownerPhone: typeof b.owner_phone === "string" ? b.owner_phone.slice(0, 30) : null,
    planId: String(b.plan_id ?? ""),
    status,
    trialEndsAt: status === "trialing" ? new Date(Date.now() + trialDays * 86_400_000).toISOString() : null,
    origin: siteOrigin(new URL(req.url).origin),
    actor: { id: owner.userId, email: owner.email },
  });
  return NextResponse.json(result);
}
