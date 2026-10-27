"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  BarChart3,
  ClipboardList,
  CreditCard,
  Tags,
  CarFront,
  Users,
  Code2,
  Radio,
  Map as MapIcon,
  CalendarDays,
  Headset,
  ScrollText,
  Settings,
  ShieldCheck,
  Handshake,
  DatabaseBackup,
  BookOpen,
  Menu,
  X,
} from "lucide-react";
import SignOutButton from "@/components/dashboard/SignOutButton";
import { cn } from "@/lib/format";
import { LogoMark } from "@/components/Brand";
import NotificationBell from "@/components/dashboard/NotificationBell";
import { useBrand } from "@/components/BrandProvider";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/dispatch", label: "Dispatch", icon: Radio },
  { href: "/admin/map", label: "Driver map", icon: MapIcon },
  { href: "/admin/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/bookings", label: "Bookings", icon: ClipboardList },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/pricing", label: "Pricing", icon: Tags },
  { href: "/admin/drivers", label: "Drivers", icon: CarFront },
  { href: "/admin/dispatchers", label: "Dispatchers", icon: Headset },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/websites", label: "Widgets", icon: Code2 },
  { href: "/admin/logs", label: "Activity Logs", icon: ScrollText },
  { href: "/admin/settings", label: "Settings", icon: Settings },
  { href: "/admin/backups", label: "Backups", icon: DatabaseBackup },
  { href: "/documentation", label: "Help & docs", icon: BookOpen },
  { href: "/dispatch/network", label: "Partner network", icon: Handshake },
  { href: "/account", label: "Plan & billing", icon: CreditCard },
  { href: "/security", label: "Two-factor sign-in", icon: ShieldCheck },
];

export default function AdminShell({
  name,
  role = "Administrator",
  children,
}: {
  name: string;
  role?: string;
  children: React.ReactNode;
}) {
  const brand = useBrand();
  const pathname = usePathname();
  // Phone menu. Closed again whenever the page changes.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }
  const current = NAV.find((n) => n.href === pathname)?.label ?? "Admin";

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-gray-200 bg-white md:flex print:hidden">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <LogoMark size={36} />
          <div className="min-w-0">
            <p className="font-display text-sm font-bold leading-tight text-ink-950">{brand.name}</p>
            <p className="text-xs text-gray-400">Admin</p>
          </div>
          <div className="ml-auto">
            <NotificationBell variant="sidebar" />
          </div>
        </div>

        {/* Scrolls on short screens so Sign out below always stays visible. */}
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "text-brand-700" : "text-gray-500 hover:bg-gray-50 hover:text-ink-950"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="admin-active"
                    className="absolute inset-0 rounded-xl bg-brand-50"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
                <item.icon className="relative h-[18px] w-[18px]" />
                <span className="relative">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-gray-100 p-3">
          <div className="flex min-w-0 items-center gap-2.5 px-2 py-1.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
              {name.charAt(0)}
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-ink-950">{name}</p>
              <p className="text-[11px] text-gray-400">{role}</p>
            </div>
          </div>
          <SignOutButton dark={false} full />
        </div>
      </aside>

      {/* Top bar + menu — phones only */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2.5 border-b border-gray-200 bg-white/95 px-4 backdrop-blur md:hidden print:hidden">
        <LogoMark size={30} />
        <p className="min-w-0 flex-1 truncate font-display text-sm font-bold text-ink-950">{current}</p>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-950 hover:bg-gray-100"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden print:hidden">
          <button aria-label="Close menu" onClick={() => setMenuOpen(false)} className="absolute inset-0 bg-black/40" />
          <div className="absolute inset-x-0 top-14 flex max-h-[calc(100dvh-3.5rem)] flex-col border-b border-gray-200 bg-white shadow-xl">
            <nav className="grid min-h-0 grid-cols-2 gap-1 overflow-y-auto p-3">
              {NAV.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl px-3 py-3 text-sm font-medium",
                      active ? "bg-brand-50 text-brand-700" : "text-gray-600 active:bg-gray-50"
                    )}
                  >
                    <item.icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="flex items-center gap-3 border-t border-gray-100 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-950">
                {name} <span className="font-normal text-gray-400">· {role}</span>
              </p>
              <div className="w-32">
                <SignOutButton dark={false} full />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main */}
      <main className="min-w-0 flex-1 pt-14 md:ml-60 md:pt-0 print:ml-0 print:pt-0">{children}</main>
      <div className="print:hidden">
        <NotificationBell variant="floating" />
      </div>
    </div>
  );
}
