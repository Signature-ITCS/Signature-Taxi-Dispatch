"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Loader2, type LucideIcon } from "lucide-react";

export interface PlaceValue {
  address: string;
  lat: number | null;
  lng: number | null;
}

interface Prediction {
  description: string;
  place_id: string;
}

interface Props {
  label: string;
  icon: LucideIcon;
  iconClass?: string;
  value: string;
  placeholder?: string;
  onChange: (address: string) => void;
  onSelect: (place: PlaceValue) => void;
}

export default function AddressAutocomplete({
  label,
  icon: Icon,
  iconClass = "text-brand-500",
  value,
  placeholder,
  onChange,
  onSelect,
}: Props) {
  const [preds, setPreds] = useState<Prediction[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch predictions as the user types (debounced)
  useEffect(() => {
    if (skipRef.current) {
      skipRef.current = false;
      return;
    }
    if (!value || value.trim().length < 3) {
      setPreds([]);
      setOpen(false);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/places", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: value }),
        });
        const data = await res.json();
        setPreds(data.predictions ?? []);
        setOpen((data.predictions ?? []).length > 0);
      } catch {
        setPreds([]);
      }
      setLoading(false);
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const pick = async (p: Prediction) => {
    skipRef.current = true;
    setOpen(false);
    setPreds([]);
    try {
      const res = await fetch("/api/place-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place_id: p.place_id }),
      });
      const data = await res.json();
      if (data.ok) {
        onSelect({ address: data.address ?? p.description, lat: data.lat, lng: data.lng });
        return;
      }
    } catch {
      /* fall through */
    }
    onSelect({ address: p.description, lat: null, lng: null });
  };

  return (
    <div className="relative" ref={boxRef}>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </span>
      <div className="relative">
        <Icon
          className={`pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 ${iconClass}`}
          strokeWidth={2.2}
        />
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => preds.length > 0 && setOpen(true)}
          className="w-full rounded-xl border border-gray-200 bg-white py-3.5 pl-11 pr-9 text-[15px] text-ink-950 outline-none transition-all placeholder:text-gray-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-300" />
        )}
      </div>

      {open && preds.length > 0 && (
        <div className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-xl border border-gray-100 bg-white shadow-xl">
          {preds.map((p) => (
            <button
              key={p.place_id}
              type="button"
              onClick={() => pick(p)}
              className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left text-sm text-ink-950 transition-colors hover:bg-brand-50"
            >
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
              <span>{p.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
