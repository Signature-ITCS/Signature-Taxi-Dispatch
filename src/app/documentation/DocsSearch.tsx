"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

/** Search every page and section title of the documentation. */
export default function DocsSearch({ items }: { items: { href: string; title: string; group: string }[] }) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return items.filter((i) => i.title.toLowerCase().includes(t) || i.group.toLowerCase().includes(t)).slice(0, 8);
  }, [q, items]);
  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-1.5">
        <Search className="h-4 w-4 text-gray-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. stripe webhook" className="w-44 text-sm outline-none sm:w-64" />
      </div>
      {hits.length > 0 && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-gray-100 bg-white p-1.5 shadow-xl">
          {hits.map((h) => (
            <Link key={h.href} href={h.href} onClick={() => setQ("")} className="block rounded-lg px-3 py-2 text-sm hover:bg-gray-50">
              <span className="block text-ink-950">{h.title}</span>
              <span className="text-xs text-gray-400">{h.group}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
