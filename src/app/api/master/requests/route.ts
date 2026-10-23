import { NextResponse } from "next/server";
import { getPlatformAdmin, audit } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";

/** Setup and restore requests from companies (platform owner). */
export async function GET() {
  if (!(await getPlatformAdmin())) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const admin = createAdminClient();
  const [{ data: setup }, { data: restore }] = await Promise.all([
    admin.from("setup_requests").select("*, companies(name, slug)").order("created_at", { ascending: false }).limit(200),
    admin.from("restore_requests").select("*, companies(name, slug)").order("created_at", { ascending: false }).limit(200),
  ]);
  return NextResponse.json({ ok: true, setup: setup ?? [], restore: restore ?? [] });
}

/** { kind: "setup"|"restore", id, status?, paid? } */
export async function PATCH(req: Request) {
  const owner = await getPlatformAdmin();
  if (!owner) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const table = b.kind === "restore" ? "restore_requests" : b.kind === "setup" ? "setup_requests" : null;
  if (!table || typeof b.id !== "string") return NextResponse.json({ ok: false, error: "bad_request" });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof b.status === "string" && ["new", "in_progress", "done", "cancelled"].includes(b.status)) patch.status = b.status;
  if (typeof b.paid === "boolean") patch.paid = b.paid;
  await createAdminClient().from(table).update(patch).eq("id", b.id);
  await audit(`${b.kind}_request_updated`, { actorId: owner.userId, actorEmail: owner.email, detail: { id: b.id, ...patch } });
  return NextResponse.json({ ok: true });
}
