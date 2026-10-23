"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Building2, Tags, LifeBuoy, Settings, ScrollText, LogOut, Crown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const NAV = [
  { href: "/master", label: "Overview", icon: LayoutDashboard },
  { href: "/master/companies", label: "Companies", icon: Building2 },
  { href: "/master/plans", label: "Plans", icon: Tags },
  { href: "/master/requests", label: "Requests", icon: LifeBuoy },
  { href: "/master/settings", label: "Platform settings", icon: Settings },
  { href: "/master/audit", label: "Audit log", icon: ScrollText },
];

export default function MasterShell({ platformName, email, children }: { platformName: string; email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const signOut = async () => {
    await createClient().auth.signOut();
    router.replace("/login");
  };
  return (
    <div className="min-h-screen bg-gray-50 md:flex">
      <aside className="border-b border-gray-200 bg-ink-950 text-white md:fixed md:inset-y-0 md:w-60 md:border-b-0">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
            <Crown className="h-5 w-5 text-amber-300" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-bold">{platformName}</p>
            <p className="text-xs text-white/50">Master dashboard</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/master" ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm ${active ? "bg-white/15 font-semibold" : "text-white/70 hover:bg-white/5 hover:text-white"}`}
              >
                <Icon className="h-4 w-4" /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden px-5 py-4 md:absolute md:bottom-0 md:block md:w-full">
          <p className="truncate text-xs text-white/50">{email}</p>
          <button onClick={signOut} className="mt-2 flex items-center gap-2 text-sm text-white/70 hover:text-white">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-4 sm:p-8 md:ml-60">{children}</main>
    </div>
  );
}
