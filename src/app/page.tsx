import { redirect } from "next/navigation";
import { getSessionProfile, homeForRole } from "@/lib/auth";

/**
 * "/" never shows a mixed screen. Signed-in staff go to their board; everyone
 * else is a customer and goes straight to booking. Staff sign in at /login,
 * which is also where the installed staff app opens.
 */
export default async function Home() {
  const profile = await getSessionProfile();
  if (profile && profile.is_active && (profile.role === "admin" || profile.role === "dispatcher")) {
    redirect(homeForRole(profile.role));
  }
  redirect("/book");
}
