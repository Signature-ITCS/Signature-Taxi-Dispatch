import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Where the "choose your password" email links land. The one-time token signs
 * the user in (session cookie set here), then they go on to choose a password.
 * A used or expired link goes to the "send a new link" page instead.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  // Only our own pages — never an address from the link.
  const nextParam = url.searchParams.get("next") ?? "/auth/set-password";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/auth/set-password";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL("/auth/forgot?expired=1", url.origin));
}
