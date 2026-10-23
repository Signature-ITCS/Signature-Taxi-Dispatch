import Link from "next/link";
import { BookOpen, Lock } from "lucide-react";
import { DOC_GROUPS } from "@/content/docs";
import { getPlatformName } from "@/lib/companyBrand";
import { getPlatformAdmin } from "@/lib/tenant";
import DocsSearch from "./DocsSearch";

export const metadata = { title: "Documentation" };

/** /documentation — guides for companies, dispatchers, drivers and the platform owner. */
export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const [name, owner] = await Promise.all([getPlatformName(), getPlatformAdmin()]);
  const index = DOC_GROUPS.flatMap((g) =>
    g.pages
      .filter((p) => p.audience !== "owner" || owner)
      .flatMap((p) => [
        { href: `/documentation/${p.slug}`, title: p.title, group: g.title },
        ...p.sections.map((s) => ({ href: `/documentation/${p.slug}#${s.id}`, title: `${p.title} › ${s.title}`, group: g.title })),
      ])
  );
  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-30 border-b border-gray-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/documentation" className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
            <BookOpen className="h-5 w-5 text-brand-600" /> {name} · Documentation
          </Link>
          <div className="flex items-center gap-3">
            <DocsSearch items={index} />
            <Link href="/login" className="hidden text-sm font-semibold text-gray-600 hover:text-ink-950 sm:inline">Sign in</Link>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl gap-8 px-5 py-8">
        <aside className="sticky top-20 hidden h-[calc(100vh-6rem)] w-64 shrink-0 overflow-y-auto pb-10 lg:block">
          {DOC_GROUPS.map((g) => (
            <div key={g.title} className="mb-5">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{g.title}</p>
              {g.pages.map((p) =>
                p.audience === "owner" && !owner ? (
                  <p key={p.slug} className="flex items-center gap-1.5 py-1 text-sm text-gray-300">
                    <Lock className="h-3 w-3" /> {p.title}
                  </p>
                ) : (
                  <Link key={p.slug} href={`/documentation/${p.slug}`} className="block rounded-lg py-1 text-sm text-gray-600 hover:text-brand-600">
                    {p.title}
                  </Link>
                )
              )}
            </div>
          ))}
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
