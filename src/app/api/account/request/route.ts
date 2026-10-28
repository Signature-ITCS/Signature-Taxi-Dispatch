import { NextResponse } from "next/server";
import { getStaffContext, audit } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServices } from "@/lib/services";
import { notifyOwner, siteOrigin } from "@/lib/provision";
import { clientIp, rateLimitShared } from "@/lib/rateLimit";

/**
 * A company asks the platform for paid help:
 *   kind "setup"   — "We'll set it up for you" (a setup package);
 *   kind "restore" — restore a backup (plans without self-service restore).
 * The request is recorded and the platform owner is emailed; the owner sends a
 * payment link by hand and marks the request paid in Master → Requests.
 */
export async function POST(req: Request) {
  if (!(await rateLimitShared(`help-request:${clientIp(req)}`, 10, 60 * 60_000))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const ctx = await getStaffContext();
  if (!ctx || ctx.profile.role !== "admin" || !ctx.profile.is_active) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = b.kind === "restore" ? "restore" : b.kind === "setup" ? "setup" : null;
  if (!kind) return NextResponse.json({ ok: false, error: "bad_request" });
  const details = String(b.details ?? "").trim().slice(0, 2000);

  const services = await getServices();
  const admin = createAdminClient();
  const origin = siteOrigin(new URL(req.url).origin);
  let price = 0;
  let label = "";
  let requestId: string;

  if (kind === "setup") {
    const pkg = services.setup_packages.find((p) => p.code === b.package);
    if (!pkg) return NextResponse.json({ ok: false, error: "unknown_package" });
    price = Number(pkg.price) || 0;
    label = pkg.name;
    const { data, error } = await admin
      .from("setup_requests")
      .insert({
        company_id: ctx.company.id,
        package: pkg.code,
        details,
        contact_name: ctx.profile.full_name,
        contact_email: ctx.profile.email ?? ctx.email,
      })
      .select("id")
      .single();
    if (error || !data) return NextResponse.json({ ok: false, error: "save_failed" });
    requestId = data.id as string;
  } else {
    const date = typeof b.backup_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.backup_date) ? b.backup_date : null;
    price = services.restore_price;
    label = "Backup restore";
    const { data, error } = await admin
      .from("restore_requests")
      .insert({ company_id: ctx.company.id, backup_date: date, note: details, requested_by: ctx.userId })
      .select("id")
      .single();
    if (error || !data) return NextResponse.json({ ok: false, error: "save_failed" });
    requestId = data.id as string;
  }

  await audit(`${kind}_requested`, { actorId: ctx.userId, actorEmail: ctx.email, companyId: ctx.company.id, detail: { requestId, label } });
  await notifyOwner(
    `${label} requested: ${ctx.company.name}`,
    [
      ["Company", ctx.company.name],
      ["From", `${ctx.profile.full_name} <${ctx.profile.email ?? ctx.email ?? ""}>`],
      ["What", label],
      ["Price", price ? `£${price}` : "by quote"],
      ["Details", details || "—"],
    ],
    `${origin}/master/requests`
  );

  // Paid help is paid by hand: we send the company a payment link and mark
  // the request paid in Master → Requests.
  return NextResponse.json({ ok: true });
}
