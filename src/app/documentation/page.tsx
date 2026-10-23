import Link from "next/link";
import { Lock, ChevronRight } from "lucide-react";
import { DOC_GROUPS } from "@/content/docs";
import { getPlatformAdmin } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** Table of contents: every guide, grouped by who it is for. */
export default async function DocsHome() {
  const owner = await getPlatformAdmin();
  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-3xl font-bold text-ink-950">Documentation</h1>
      <p className="mt-2 text-gray-600">
        Step-by-step guides for every setting — for company admins, dispatchers, drivers and developers. Every &ldquo;How to?&rdquo; link in
        the app opens the right section here.
      </p>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {DOC_GROUPS.map((g) => {
          const locked = g.pages.every((p) => p.audience === "owner") && !owner;
          return (
            <section key={g.title} className="rounded-2xl border border-gray-100 p-5">
              <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink-950">
                {locked && <Lock className="h-4 w-4 text-gray-400" />} {g.title}
              </h2>
              <p className="text-sm text-gray-500">{g.description}</p>
              {locked ? (
                <p className="mt-3 text-sm text-gray-500">
                  <Link href="/login?next=/documentation" className="font-semibold text-brand-600">Sign in as the platform owner</Link> to read these.
                </p>
              ) : (
                <ul className="mt-3 space-y-1">
                  {g.pages.map((p) => (
                    <li key={p.slug}>
                      <Link href={`/documentation/${p.slug}`} className="group flex items-start gap-1 text-sm">
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-300 group-hover:text-brand-600" />
                        <span>
                          <span className="font-semibold text-ink-950 group-hover:text-brand-600">{p.title}</span>
                          <span className="block text-gray-500">{p.summary}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
