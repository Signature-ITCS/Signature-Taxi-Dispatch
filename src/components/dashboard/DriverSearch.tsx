"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Check } from "lucide-react";
import { cn } from "@/lib/format";

export interface SearchableDriver {
  id: string;
  full_name: string;
  phone?: string | null;
  whatsapp?: string | null;
  service_area?: string | null;
  /** Shown after the name, e.g. "available" / "busy". */
  tag?: string | null;
  /** Can't be picked (e.g. busy on another job). */
  disabled?: boolean;
}

/** Name, phone or area contains every typed word — "jo man" finds "John, Manchester". */
export function matchesDriver(d: SearchableDriver, query: string): boolean {
  const hay = `${d.full_name} ${d.phone ?? ""} ${d.whatsapp ?? ""} ${d.service_area ?? ""}`.toLowerCase();
  const digits = hay.replace(/\s/g, "");
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w) || (/^\+?\d+$/.test(w) && digits.includes(w.replace("+", ""))));
}

/**
 * Type-to-search driver picker — works the same with 5 drivers or 500.
 * Shows the best 50 matches; arrow keys + Enter to choose, Esc to close.
 */
export default function DriverSearch({
  drivers,
  value,
  onChange,
  placeholder = "Type a driver's name…",
  allowClear,
  clearLabel = "All drivers",
  disabled,
  className,
}: {
  drivers: SearchableDriver[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  /** Offer a first option that clears the choice ("All drivers"). */
  allowClear?: boolean;
  clearLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const selected = drivers.find((d) => d.id === value) ?? null;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const list = query.trim() ? drivers.filter((d) => matchesDriver(d, query)) : drivers;
    return list.slice(0, 50);
  }, [drivers, query]);
  const options: (SearchableDriver | null)[] = allowClear ? [null, ...matches] : matches;

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const choose = (d: SearchableDriver | null) => {
    if (d?.disabled) return;
    onChange(d?.id ?? null);
    setQuery("");
    setOpen(false);
    input.current?.blur();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      const pick = options[active];
      if (pick !== undefined) choose(pick);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={box} className={cn("relative", className)}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border bg-white px-2.5",
          open ? "border-brand-400 ring-2 ring-brand-500/10" : "border-gray-200",
          disabled && "opacity-60"
        )}
      >
        <Search className="h-4 w-4 shrink-0 text-gray-400" />
        <input
          ref={input}
          value={open ? query : (selected?.full_name ?? (allowClear && !value ? clearLabel : ""))}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => {
            setQuery("");
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKey}
          placeholder={selected ? selected.full_name : placeholder}
          disabled={disabled}
          className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none placeholder:text-gray-400 sm:text-sm"
        />
        {value && allowClear && !disabled && (
          <button type="button" onClick={() => choose(null)} className="text-gray-400 hover:text-gray-600" aria-label="Clear">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && (
        <ul className="absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-xl">
          {options.length === 0 && <li className="px-3 py-3 text-sm text-gray-400">No driver matches “{query}”.</li>}
          {options.map((d, i) => (
            <li key={d?.id ?? "__all"}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(d)}
                disabled={!!d?.disabled}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                  i === active ? "bg-brand-50" : "",
                  d?.disabled ? "cursor-not-allowed text-gray-300" : "text-ink-950"
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{d ? d.full_name : clearLabel}</span>
                  {d && (d.service_area || d.whatsapp || d.phone) && (
                    <span className="block truncate text-xs text-gray-400">
                      {[d.service_area, d.whatsapp ?? d.phone].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-gray-400">
                  {d?.tag}
                  {(d?.id ?? null) === value && <Check className="h-4 w-4 text-brand-600" />}
                </span>
              </button>
            </li>
          ))}
          {!query && drivers.length > 50 && (
            <li className="px-3 py-2 text-xs text-gray-400">Showing 50 of {drivers.length} — type to search.</li>
          )}
        </ul>
      )}
    </div>
  );
}
