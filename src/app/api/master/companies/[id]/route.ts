import { NextResponse } from "next/server";
import { getPlatformAdmin, getCompany, audit } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPasswordLink, siteOrigin } from "@/lib/provision";
import { clearBrandCache } from "@/lib/companyBrand";
import { generateInvoices } from "@/lib/billing";

const STATUSES = ["pending", "trialing", "active", "past_due", "suspended", "cancelled"];

/**
 * Change a company (platform owner): status (suspend / reactivate), plan,
 * notes — or re-send the owner's "choose your password" email.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await getPlatformAdmin();
  if (!owner) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const { id } = await ctx.params;
  const company = await getCompany(id);
  if (!company) return NextResponse.json({ ok: false, error: "not_found" });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const admin = createAdminClient();
  const patch: Record<string, unknown> = {};

  if (typeof b.status === "string" && STATUSES.includes(b.status)) patch.status = b.status;
  if (typeof b.plan_id === "string") {
    const { data: plan } = await admin.from("plans").select("id").eq("id", b.plan_id).maybeSingle();
    if (!plan) return NextResponse.json({ ok: false, error: "unknown_plan" });
    patch.plan_id = b.plan_id;
  }
  if (typeof b.notes === "string") patch.notes = b.notes.slice(0, 4000);
  if (typeof b.owner_phone === "string") patch.owner_phone = b.owner_phone.trim().slice(0, 30) || null;
  if (typeof b.billing_paused === "boolean") patch.billing_paused = b.billing_paused;

  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    const { error } = await admin.from("companies").update(patch).eq("id", id);
    if (error) {
      return NextResponse.json({ ok: false, error: "save_failed" });
    }
    clearBrandCache(id);
    await audit("company_updated", { actorId: owner.userId, actorEmail: owner.email, companyId: id, detail: patch });
  }

  // A sign-up waiting for approval: approve starts its trial (or makes it
  // active) and emails the owner their sign-in link; reject removes it.
  if (b.approve === true || b.reject === true) {
    if (company.status !== "pending") return NextResponse.json({ ok: false, error: "not_pending" });
    if (b.reject === true) {
      const { data: logins } = await admin.from("profiles").select("id").eq("company_id", id);
      const { error } = await admin.from("companies").delete().eq("id", id);
      if (error) return NextResponse.json({ ok: false, error: "delete_failed" });
      for (const l of logins ?? []) await admin.auth.admin.deleteUser(l.id as string).catch(() => {});
      await audit("signup_rejected", { actorId: owner.userId, actorEmail: owner.email, detail: { id, name: company.name, email: company.owner_email } });
      return NextResponse.json({ ok: true, deleted: true });
    }
    const { data: plan } = await admin.from("plans").select("name, trial_days").eq("id", company.plan_id ?? "").maybeSingle();
    const trialDays = Number(plan?.trial_days) || 0;
    const { error } = await admin
      .from("companies")
      .update({
        status: trialDays > 0 ? "trialing" : "active",
        trial_ends_at: trialDays > 0 ? new Date(Date.now() + trialDays * 86_400_000).toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: "save_failed" });
    clearBrandCache(id);
    // No trial: its first invoice goes on the Billing list now.
    await generateInvoices(7).catch(() => 0);
    const { data: prof } = await admin.from("profiles").select("email, full_name").eq("company_id", id).eq("role", "admin").limit(1).maybeSingle();
    const emailed = prof?.email
      ? await sendPasswordLink({
          email: prof.email as string,
          fullName: (prof.full_name as string) ?? "",
          companyName: company.name,
          planName: (plan?.name as string) ?? undefined,
          kind: "welcome",
          origin: siteOrigin(new URL(req.url).origin),
          slug: company.slug,
        })
      : false;
    await audit("signup_approved", { actorId: owner.userId, actorEmail: owner.email, companyId: id, detail: { trial_days: trialDays, emailed } });
    return NextResponse.json({ ok: true, emailed });
  }

  if (b.resend_welcome === true) {
    if (company.status === "pending") return NextResponse.json({ ok: false, error: "not_approved" });
    const { data: prof } = await admin
      .from("profiles")
      .select("email, full_name")
      .eq("company_id", id)
      .eq("role", "admin")
      .eq("email", company.owner_email ?? "")
      .maybeSingle();
    if (!prof?.email) return NextResponse.json({ ok: false, error: "no_owner_login" });
    const sent = await sendPasswordLink({
      email: prof.email as string,
      fullName: (prof.full_name as string) ?? "",
      companyName: company.name,
      kind: "welcome",
      origin: siteOrigin(new URL(req.url).origin),
      slug: company.slug,
    });
    await audit("welcome_resent", { actorId: owner.userId, actorEmail: owner.email, companyId: id });
    return NextResponse.json({ ok: sent, error: sent ? undefined : "email_failed" });
  }
  return NextResponse.json({ ok: true });
}

/**
 * Delete a company and ALL its data (platform owner, typing the company name).
 * Its staff and driver logins are removed too. Cannot be undone — its last
 * nightly backup file stays in storage until it ages out.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await getPlatformAdmin();
  if (!owner) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const { id } = await ctx.params;
  const company = await getCompany(id);
  if (!company) return NextResponse.json({ ok: false, error: "not_found" });
  const { confirm } = (await req.json().catch(() => ({}))) as { confirm?: string };
  if (String(confirm ?? "").trim() !== company.name.trim()) return NextResponse.json({ ok: false, error: "confirm_mismatch" });

  const admin = createAdminClient();
  const { data: logins } = await admin.from("profiles").select("id").eq("company_id", id);
  const { error } = await admin.from("companies").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: "delete_failed" });
  for (const l of logins ?? []) await admin.auth.admin.deleteUser(l.id as string).catch(() => {});
  await audit("company_deleted", { actorId: owner.userId, actorEmail: owner.email, detail: { id, name: company.name, slug: company.slug } });
  return NextResponse.json({ ok: true });
}
