import { NextResponse } from "next/server";
import { getOfficeContext } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { tenantDb } from "@/lib/tenantDb";

/** Admin-only: delete a dispatcher login account (auth user + profile). */
export async function POST(req: Request) {
  const office = await getOfficeContext({ adminOnly: true });
  if (!office) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }
  const me = office.profile;
  const db = tenantDb(office.company.id);

  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ ok: false, error: "missing_id" });
  if (id === me.id) return NextResponse.json({ ok: false, error: "cannot_delete_self" });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ ok: false, error: "no_service_role_key" });
  }

  // Only this company's dispatcher accounts can be removed here (never an admin).
  const { data: target } = await db.from("profiles").select("role, full_name, email").eq("id", id).maybeSingle();
  if (!target || target.role !== "dispatcher") {
    return NextResponse.json({ ok: false, error: "not_a_dispatcher" });
  }

  // Unlink from any past bookings so the delete can't fail on a foreign key,
  // then remove the login + profile.
  await db.from("bookings").update({ dispatcher_id: null }).eq("dispatcher_id", id);
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ ok: false, error: error.message });
  await db.from("profiles").delete().eq("id", id);

  await db.from("activity_logs").insert({
    actor_id: me.id,
    actor_name: me.full_name,
    actor_role: me.role,
    action: "dispatcher_removed",
    description: `Removed dispatcher: ${target.full_name} (${target.email ?? "no email"})`,
  });

  return NextResponse.json({ ok: true });
}
