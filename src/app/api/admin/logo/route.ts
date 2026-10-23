import { NextResponse } from "next/server";
import { getOfficeContext } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { tenantDb } from "@/lib/tenantDb";
import { clearBrandCache } from "@/lib/companyBrand";
import { clearSettingsCache } from "@/lib/settings";

/**
 * Upload the company logo (admins). Saved in the public "branding" bucket under
 * the company's own folder; the setting then points at it. PNG/JPG/WebP only —
 * never SVG, which can carry script.
 */
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function POST(req: Request) {
  const office = await getOfficeContext({ adminOnly: true });
  if (!office) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  const companyId = office.company.id;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "no_file" });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ ok: false, error: "bad_type" });
  if (file.size > 1024 * 1024) return NextResponse.json({ ok: false, error: "too_big" });

  // Check the bytes really are that kind of image, not just the label.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const magic = Array.from(bytes.slice(0, 12));
  const isPng = magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4e && magic[3] === 0x47;
  const isJpg = magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff;
  const isWebp = String.fromCharCode(...magic.slice(0, 4)) === "RIFF" && String.fromCharCode(...magic.slice(8, 12)) === "WEBP";
  if (!(ext === "png" ? isPng : ext === "jpg" ? isJpg : isWebp)) return NextResponse.json({ ok: false, error: "bad_type" });

  const admin = createAdminClient();
  const path = `${companyId}/logo-${Date.now()}.${ext}`;
  const { error } = await admin.storage.from("branding").upload(path, bytes, { contentType: file.type, upsert: false });
  if (error) {
    console.error("[logo] upload failed", error);
    return NextResponse.json({ ok: false, error: "upload_failed" });
  }
  const url = admin.storage.from("branding").getPublicUrl(path).data.publicUrl;

  const db = tenantDb(companyId);
  const { data: row } = await db.from("app_settings").select("value").eq("key", "branding").maybeSingle();
  const value = { ...((row?.value as Record<string, unknown>) ?? {}), logo_url: url };
  await db.from("app_settings").upsert({ key: "branding", value }, { onConflict: "company_id,key" });
  clearBrandCache(companyId);
  clearSettingsCache();
  return NextResponse.json({ ok: true, url });
}
