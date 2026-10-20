"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/format";

export const PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * Page number + page size for one list. The page size is remembered per list
 * (in this browser) so each screen opens the way its user left it.
 */
export function usePageState(listKey: string, defaultSize = 25) {
  const storageKey = `bf:page-size:${listKey}`;
  const [pageSize, setPageSizeState] = useState(defaultSize);
  const [page, setPage] = useState(1);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if ((PAGE_SIZES as readonly number[]).includes(saved)) setPageSizeState(saved);
    } catch {
      /* storage unavailable — keep the default */
    }
  }, [storageKey]);

  const setPageSize = (n: number) => {
    setPageSizeState(n);
    setPage(1);
    try {
      localStorage.setItem(storageKey, String(n));
    } catch {
      /* ignore */
    }
  };

  return { page, setPage, pageSize, setPageSize };
}

/** Paging for a list that is already loaded in full (drivers, customers…). */
export function usePagedList<T>(items: T[], listKey: string, defaultSize = 25) {
  const state = usePageState(listKey, defaultSize);
  const { page, setPage, pageSize } = state;
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  // A filter that shrinks the list must not strand you on an empty page.
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages, setPage]);
  const pageItems = useMemo(
    () => items.slice((Math.min(page, pages) - 1) * pageSize, Math.min(page, pages) * pageSize),
    [items, page, pages, pageSize]
  );
  return { ...state, pageItems, total: items.length };
}

/** "Showing 26–50 of 312" · page buttons · per-page choice. */
export default function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  // 1 … 4 5 [6] 7 8 … 20
  const nums: (number | "…")[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }

  const go = (p: number) => {
    onPage(Math.min(Math.max(1, p), pages));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className={cn("flex flex-col items-center justify-between gap-3 text-sm sm:flex-row", className)}>
      <div className="flex items-center gap-2 text-gray-500">
        <span>
          {total === 0 ? (
            "No results"
          ) : (
            <>
              Showing <b className="text-ink-950">{first}</b>–<b className="text-ink-950">{last}</b> of{" "}
              <b className="text-ink-950">{total.toLocaleString("en-GB")}</b>
            </>
          )}
        </span>
        <span className="text-gray-300">·</span>
        <label className="flex items-center gap-1.5">
          <span>Per page</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm text-ink-950 outline-none focus:border-brand-400"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {pages > 1 && (
        <nav className="flex items-center gap-1" aria-label="Pages">
          <PageBtn onClick={() => go(page - 1)} disabled={page <= 1} label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </PageBtn>
          {nums.map((n, i) =>
            n === "…" ? (
              <span key={`gap-${i}`} className="px-1 text-gray-400">
                …
              </span>
            ) : (
              <PageBtn key={n} onClick={() => go(n)} active={n === page} label={`Page ${n}`}>
                {n}
              </PageBtn>
            )
          )}
          <PageBtn onClick={() => go(page + 1)} disabled={page >= pages} label="Next page">
            <ChevronRight className="h-4 w-4" />
          </PageBtn>
        </nav>
      )}
    </div>
  );
}

function PageBtn({
  children,
  onClick,
  disabled,
  active,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-semibold transition-colors",
        active ? "bg-ink-950 text-white" : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
        disabled && "cursor-not-allowed opacity-40 hover:bg-white"
      )}
    >
      {children}
    </button>
  );
}
