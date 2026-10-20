import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailEnabled } from "@/lib/email";
import { staffWelcomeEmail } from "@/lib/emailTemplates";

/**
 * Admin-only: give an existing driver a login for the driver app.
 *
 * Creates the auth user, a profile with role "driver", and links it to the
 * driver's record (drivers.profile_id) — that link is what lets the driver see
 * their own jobs and nothing else. Emails the login details with the driver
 * app install link.
 *
 * DELETE removes the login again (the driver record and its history stay).
 */
export async function POST(req: Request) {
  const me = await getSessionProfile();
  if (!me || me.role !== "admin") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }
  const admin = createAdminClient();

  const { driver_id, email, password } = (await req.json().catch(() => ({}))) as {
    driver_id?: string;
    email?: string;
    password?: string;
  };
  const cleanEmail = email?.trim().toLowerCase();
  if (!driver_id || !cleanEmail || !password) return NextResponse.json({ ok: false, error: "missing_fields" });
  if (password.length < 8) return NextResponse.json({ ok: false, error: "password_too_short" });

  const { data: driver } = await admin
    .from("drivers")
    .select("id, full_name, phone, whatsapp, profile_id")
    .eq("id", driver_id)
    .maybeSingle();
  if (!driver) return NextResponse.json({ ok: false, error: "driver_not_found" });
  if (driver.profile_id) return NextResponse.json({ ok: false, error: "already_has_login" });

  const { data, error } = await admin.auth.admin.createUser({
    email: cleanEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: driver.full_name },
  });
  if (error || !data.user) {
    return NextResponse.json({ ok: false, error: error?.message ?? "create_failed" });
  }
  const uid = data.user.id;

  const { error: pErr } = await admin.from("profiles").insert({
    id: uid,
    full_name: driver.full_name,
    email: cleanEmail,
    phone: driver.whatsapp ?? driver.phone ?? null,
    role: "driver",
  });
  const { error: dErr } = pErr
    ? { error: pErr }
    : await admin.from("drivers").update({ profile_id: uid, email: cleanEmail, availability: "offline" }).eq("id", driver.id);
  if (pErr || dErr) {
    // Don't leave a login that isn't attached to anything.
    await admin.auth.admin.deleteUser(uid).catch(() => {});
    return NextResponse.json({ ok: false, error: (pErr ?? dErr)?.message ?? "link_failed" });
  }

  await admin.from("activity_logs").insert({
    actor_id: me.id,
    actor_name: me.full_name,
    actor_role: me.role,
    action: "driver_login_added",
    description: `Created driver app login for ${driver.full_name} (${cleanEmail})`,
  });

  let emailed = false;
  if (await emailEnabled()) {
    try {
      const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
      const mail = staffWelcomeEmail({
        fullName: driver.full_name,
        email: cleanEmail,
        password,
        role: "driver",
        loginUrl: `${origin}/driver/login`,
        installUrl: `${origin}/install/driver`,
        invitedBy: me.full_name || null,
      });
      emailed = await sendEmail({ to: cleanEmail, subject: mail.subject, html: mail.html });
    } catch {
      emailed = false;
    }
  }
  return NextResponse.json({ ok: true, emailed });
}

export async function DELETE(req: Request) {
  const me = await getSessionProfile();
  if (!me || me.role !== "admin") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }
  const admin = createAdminClient();
  const { driver_id } = (await req.json().catch(() => ({}))) as { driver_id?: string };
  if (!driver_id) return NextResponse.json({ ok: false, error: "missing_fields" });

  const { data: driver } = await admin.from("drivers").select("id, full_name, profile_id").eq("id", driver_id).maybeSingle();
  if (!driver?.profile_id) return NextResponse.json({ ok: false, error: "no_login" });

  await admin.from("drivers").update({ profile_id: null, availability: "offline" }).eq("id", driver.id);
  await admin.from("push_subscriptions").delete().eq("driver_id", driver.id);
  await admin.auth.admin.deleteUser(driver.profile_id).catch(() => {});

  await admin.from("activity_logs").insert({
    actor_id: me.id,
    actor_name: me.full_name,
    actor_role: me.role,
    action: "driver_login_removed",
    description: `Removed driver app login for ${driver.full_name}`,
  });
  return NextResponse.json({ ok: true });
}
