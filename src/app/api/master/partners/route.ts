import { NextResponse } from "next/server";
import { getPlatformAdmin, audit } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPasswordLink, siteOrigin } from "@/lib/provision";
import { notListedBecause, partnerPrice, type Partner } from "@/lib/partners";

/** Partner network management (platform owner only). */
export async function GET() {
  if (!(await getPlatformAdmin())) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const admin = createAdminClient();
  const [{ data: partners }, { data: contacts }, { data: reports }] = await Promise.all([
    admin.from("partners").select("*").order("created_at", { ascending: false }),
    admin.from("partner_contacts").select("partner_id, created_at").gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString()),
    admin.from("partner_reports").select("id, partner_id, user_name, reason, status, created_at, companies(name)").order("created_at", { ascending: false }).limit(200),
  ]);
  const contacts30 = new Map<string, number>();
  for (const c of contacts ?? []) contacts30.set(c.partner_id as string, (contacts30.get(c.partner_id as string) ?? 0) + 1);
  return NextResponse.json({
    ok: true,
    price: await partnerPrice(),
    partners: ((partners ?? []) as Partner[]).map((p) => ({ ...p, hidden_because: notListedBecause(p), contacts_30d: contacts30.get(p.id) ?? 0 })),
    reports: reports ?? [],
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EDITABLE = [
  "full_name", "phone", "kind", "council", "badge_number", "badge_expires", "vehicle_type", "vehicle_make", "vehicle_model",
  "vehicle_colour", "vehicle_seats", "plate_number", "vehicle_licence_number", "vehicle_licence_expires", "operator_licence_number",
  "operator_council", "operator_licence_expires", "areas", "about", "owner_notes", "paid_until",
] as const;
const REQUIRED = new Set<string>(["full_name", "phone", "council", "badge_number", "areas"]);

/**
 * { id, action } — approve | disable | enable | paid_month (+1 month from
 * today or from the current paid-until, whichever is later) | resend_login |
 * edit { fields } | report_reviewed { report_id } | delete { confirm: name } —
 * or { price } to set the monthly price shown on the join page.
 */
export async function POST(req: Request) {
  const owner = await getPlatformAdmin();
  if (!owner) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const admin = createAdminClient();
  const now = new Date().toISOString();

  if (b.price !== undefined) {
    const price = Math.max(0, Math.round(Number(b.price) || 0));
    await admin.from("platform_settings").upsert({ key: "partners", value: { monthly_price: price }, updated_at: now });
    await audit("partner_price", { actorId: owner.userId, actorEmail: owner.email, detail: { price } });
    return NextResponse.json({ ok: true });
  }

  if (b.action === "report_reviewed" && typeof b.report_id === "string") {
    await admin.from("partner_reports").update({ status: "reviewed" }).eq("id", b.report_id);
    return NextResponse.json({ ok: true });
  }

  const { data } = await admin.from("partners").select("*").eq("id", String(b.id ?? "")).maybeSingle();
  const p = data as Partner | null;
  if (!p) return NextResponse.json({ ok: false, error: "not_found" });
  const origin = siteOrigin(new URL(req.url).origin);
  const sendLogin = (userEmail: string) =>
    sendPasswordLink({ email: userEmail, fullName: p.full_name, companyName: "the partner network", kind: "welcome", origin, slug: null });

  switch (b.action) {
    case "approve": {
      let userId = p.user_id;
      if (!userId) {
        const created = await admin.auth.admin.createUser({ email: p.email, email_confirm: true, user_metadata: { full_name: p.full_name } });
        userId = created.data.user?.id ?? null;
        if (!userId) return NextResponse.json({ ok: false, error: "login_failed" });
      }
      await admin.from("partners").update({ status: "active", user_id: userId, approved_at: p.approved_at ?? now, updated_at: now }).eq("id", p.id);
      const emailed = await sendLogin(p.email);
      await audit("partner_approved", { actorId: owner.userId, actorEmail: owner.email, detail: { partner: p.id, name: p.full_name } });
      return NextResponse.json({ ok: true, emailed });
    }
    case "disable":
    case "enable": {
      const status = b.action === "disable" ? "disabled" : "active";
      if (status === "active" && !p.user_id) return NextResponse.json({ ok: false, error: "approve_first" });
      await admin.from("partners").update({ status, ...(status === "disabled" ? { available: false } : {}), updated_at: now }).eq("id", p.id);
      await audit(`partner_${b.action}d`, { actorId: owner.userId, actorEmail: owner.email, detail: { partner: p.id, name: p.full_name } });
      return NextResponse.json({ ok: true });
    }
    case "paid_month": {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
      const from = p.paid_until && p.paid_until > today ? p.paid_until : today;
      const d = new Date(`${from}T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      const paid_until = d.toISOString().slice(0, 10);
      await admin.from("partners").update({ paid_until, updated_at: now }).eq("id", p.id);
      await audit("partner_paid", { actorId: owner.userId, actorEmail: owner.email, detail: { partner: p.id, paid_until } });
      return NextResponse.json({ ok: true, paid_until });
    }
    case "resend_login": {
      if (!p.user_id) return NextResponse.json({ ok: false, error: "approve_first" });
      return NextResponse.json({ ok: await sendLogin(p.email) });
    }
    case "edit": {
      const f = (b.fields ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = { updated_at: now };
      for (const k of EDITABLE) {
        if (!(k in f)) continue;
        const v = f[k];
        if (k.endsWith("_expires") || k === "paid_until") {
          if (v === "" || v === null) {
            if (k === "badge_expires") return NextResponse.json({ ok: false, error: "badge_expires_needed" });
            patch[k] = null;
          } else if (typeof v === "string" && DATE_RE.test(v)) patch[k] = v;
          else return NextResponse.json({ ok: false, error: `invalid_${k}` });
        } else if (k === "vehicle_seats") patch[k] = v === "" || v == null ? null : Math.min(20, Math.max(1, Math.round(Number(v) || 4)));
        else if (k === "kind") patch[k] = v === "operator" ? "operator" : "driver";
        else {
          const s = typeof v === "string" ? v.trim().slice(0, k === "owner_notes" || k === "about" ? 2000 : 300) : "";
          if (REQUIRED.has(k)) {
            if (s) patch[k] = s; // a required field is never blanked
          } else patch[k] = s || null;
        }
      }
      const { error } = await admin.from("partners").update(patch).eq("id", p.id);
      if (error) return NextResponse.json({ ok: false, error: "save_failed" });
      await audit("partner_edited", { actorId: owner.userId, actorEmail: owner.email, detail: { partner: p.id, fields: Object.keys(patch) } });
      return NextResponse.json({ ok: true });
    }
    case "delete": {
      if (String(b.confirm ?? "").trim() !== p.full_name.trim()) return NextResponse.json({ ok: false, error: "confirm_mismatch" });
      await admin.from("partners").delete().eq("id", p.id);
      if (p.user_id) await admin.auth.admin.deleteUser(p.user_id).catch(() => {});
      await audit("partner_deleted", { actorId: owner.userId, actorEmail: owner.email, detail: { name: p.full_name, email: p.email } });
      return NextResponse.json({ ok: true });
    }
  }
  return NextResponse.json({ ok: false, error: "bad_action" });
}
