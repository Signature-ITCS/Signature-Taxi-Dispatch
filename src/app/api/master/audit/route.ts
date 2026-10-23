import { NextResponse } from "next/server";
import { getPlatformAdmin } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";

/** The platform audit log (platform owner): the last 300 entries. */
export async function GET() {
  if (!(await getPlatformAdmin())) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const { data } = await createAdminClient()
    .from("platform_audit")
    .select("id, created_at, action, actor_email, detail, companies(name)")
    .order("created_at", { ascending: false })
    .limit(300);
  return NextResponse.json({ ok: true, entries: data ?? [] });
}
