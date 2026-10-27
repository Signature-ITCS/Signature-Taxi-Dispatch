import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AVAILABLE_HOURS, getPartnerByUser, isAvailable, notListedBecause } from "@/lib/partners";
import { isValidPhone } from "@/lib/format";

/** The signed-in partner's own profile — and their "available now" switch. */
async function me() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return getPartnerByUser(user.id);
}

export async function GET() {
  const p = await me();
  if (!p) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const { owner_notes: _notes, user_id: _uid, ...own } = p;
  void _notes;
  void _uid;
  return NextResponse.json({ ok: true, partner: { ...own, available: isAvailable(p) }, hidden_because: notListedBecause(p) });
}

/** { available?: boolean, areas?: string, about?: string, phone?: string } */
export async function POST(req: Request) {
  const p = await me();
  if (!p || p.status === "pending") return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const now = new Date();
  const patch: Record<string, unknown> = { updated_at: now.toISOString() };
  if (typeof b.available === "boolean") {
    patch.available = b.available;
    patch.available_until = b.available ? new Date(now.getTime() + AVAILABLE_HOURS * 3_600_000).toISOString() : null;
    patch.available_changed_at = now.toISOString();
  }
  if (typeof b.areas === "string" && b.areas.trim()) patch.areas = b.areas.trim().slice(0, 300);
  if (typeof b.about === "string") patch.about = b.about.trim().slice(0, 600) || null;
  if (typeof b.phone === "string") {
    if (!isValidPhone(b.phone)) return NextResponse.json({ ok: false, error: "invalid_phone" });
    patch.phone = b.phone.trim().slice(0, 30);
  }
  // Licences and vehicle are checked by the platform owner, so only they change them.
  const { error } = await createAdminClient().from("partners").update(patch).eq("id", p.id);
  if (error) return NextResponse.json({ ok: false, error: "save_failed" });
  return NextResponse.json({ ok: true });
}
