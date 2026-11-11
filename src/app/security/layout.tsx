import { redirect } from "next/navigation";
import { TWO_FACTOR_ENABLED } from "@/lib/twoFactor";

/** Two-factor sign-in is switched off for now: this page sends people to sign-in. */
export default function SecurityLayout({ children }: { children: React.ReactNode }) {
  if (!TWO_FACTOR_ENABLED) redirect("/login");
  return children;
}
