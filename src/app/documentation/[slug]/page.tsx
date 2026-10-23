import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, ArrowLeft, ArrowRight, Hash } from "lucide-react";
import { ALL_DOCS, findDoc } from "@/content/docs";
import DocBody from "@/components/docs/DocBody";
import { getPlatformAdmin } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const doc = findDoc((await params).slug);
  return doc ? { title: `${doc.title} — Documentation`, description: doc.summary } : {};
}

const AUDIENCE: Record<string, string> = {
  company: "For company admins",
  dispatch: "For dispatchers",
  driver: "For drivers",
  customer: "About your customers",
  owner: "Platform owner only",
};

/** One documentation page; each section has an id the app's "How to?" links point at. */
export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const doc = findDoc((await params).slug);
  if (!doc) notFound();
  if (doc.audience === "owner" && !(await getPlatformAdmin())) {
    return (
      <div className="max-w-xl rounded-2xl border border-gray-100 p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-gray-400" />
        <h1 className="mt-3 font-display text-xl font-bold text-ink-950">{doc.title}</h1>
        <p className="mt-2 text-sm text-gray-600">This guide is for the platform owner.</p>
        <Link href={`/login?next=/documentation/${doc.slug}`} className="mt-5 inline-block rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
          Sign in
        </Link>
      </div>
    );
  }
  const visible = ALL_DOCS.filter((p) => p.audience !== "owner" || doc.audience === "owner");
  const i = visible.findIndex((p) => p.slug === doc.slug);
  const prev = i > 0 ? visible[i - 1] : null;
  const next = i < visible.length - 1 ? visible[i + 1] : null;

  return (
    <div className="flex gap-10">
      <article className="min-w-0 max-w-3xl flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{AUDIENCE[doc.audience]}</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-ink-950">{doc.title}</h1>
        <p className="mt-2 text-lg text-gray-600">{doc.summary}</p>
        <div className="mt-8 space-y-10">
          {doc.sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <h2 className="group flex items-center gap-2 font-display text-xl font-bold text-ink-950">
                {s.title}
                <a href={`#${s.id}`} aria-label="Link to this section" className="opacity-0 transition group-hover:opacity-100">
                  <Hash className="h-4 w-4 text-gray-300" />
                </a>
              </h2>
              <div className="mt-3">
                <DocBody body={s.body} />
              </div>
            </section>
          ))}
        </div>
        <div className="mt-14 flex justify-between gap-4 border-t border-gray-100 pt-6 text-sm">
          {prev ? (
            <Link href={`/documentation/${prev.slug}`} className="flex items-center gap-1 text-gray-600 hover:text-brand-600">
              <ArrowLeft className="h-4 w-4" /> {prev.title}
            </Link>
          ) : <span />}
          {next ? (
            <Link href={`/documentation/${next.slug}`} className="flex items-center gap-1 text-right text-gray-600 hover:text-brand-600">
              {next.title} <ArrowRight className="h-4 w-4" />
            </Link>
          ) : <span />}
        </div>
      </article>
      <nav className="sticky top-24 hidden h-fit w-56 shrink-0 xl:block">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">On this page</p>
        {doc.sections.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="block py-1 text-sm text-gray-600 hover:text-brand-600">
            {s.title}
          </a>
        ))}
      </nav>
    </div>
  );
}
