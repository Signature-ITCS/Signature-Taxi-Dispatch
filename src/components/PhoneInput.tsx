"use client";

import { useEffect, useState } from "react";
import { Phone } from "lucide-react";
import { cn } from "@/lib/format";

/** [ISO code, name, dialling code]. UK first — it is the default. */
const COUNTRIES: [string, string, string][] = [
  ["GB", "United Kingdom", "44"],
  ["IE", "Ireland", "353"],
  ["FR", "France", "33"],
  ["DE", "Germany", "49"],
  ["NL", "Netherlands", "31"],
  ["BE", "Belgium", "32"],
  ["ES", "Spain", "34"],
  ["PT", "Portugal", "351"],
  ["IT", "Italy", "39"],
  ["CH", "Switzerland", "41"],
  ["AT", "Austria", "43"],
  ["DK", "Denmark", "45"],
  ["SE", "Sweden", "46"],
  ["NO", "Norway", "47"],
  ["FI", "Finland", "358"],
  ["PL", "Poland", "48"],
  ["CZ", "Czechia", "420"],
  ["RO", "Romania", "40"],
  ["BG", "Bulgaria", "359"],
  ["HU", "Hungary", "36"],
  ["GR", "Greece", "30"],
  ["LT", "Lithuania", "370"],
  ["LV", "Latvia", "371"],
  ["TR", "Turkey", "90"],
  ["US", "United States", "1"],
  ["CA", "Canada", "1"],
  ["AU", "Australia", "61"],
  ["NZ", "New Zealand", "64"],
  ["IN", "India", "91"],
  ["PK", "Pakistan", "92"],
  ["BD", "Bangladesh", "880"],
  ["LK", "Sri Lanka", "94"],
  ["AE", "United Arab Emirates", "971"],
  ["SA", "Saudi Arabia", "966"],
  ["QA", "Qatar", "974"],
  ["EG", "Egypt", "20"],
  ["NG", "Nigeria", "234"],
  ["GH", "Ghana", "233"],
  ["KE", "Kenya", "254"],
  ["ZA", "South Africa", "27"],
  ["CN", "China", "86"],
  ["HK", "Hong Kong", "852"],
  ["SG", "Singapore", "65"],
  ["MY", "Malaysia", "60"],
  ["PH", "Philippines", "63"],
  ["JP", "Japan", "81"],
  ["BR", "Brazil", "55"],
];

const flag = (iso: string) =>
  String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

/** "+44 7700900123" from a country and whatever the person typed. */
function compose(dial: string, national: string): string {
  const digits = national.replace(/\D/g, "").replace(/^0+/, "");
  return digits ? `+${dial} ${digits}` : "";
}

/** Split a stored number back into country + national part. */
function parse(value: string, fallbackIso: string): { iso: string; national: string } {
  const v = (value ?? "").trim();
  if (v.startsWith("+")) {
    const digits = v.replace(/\D/g, "");
    // Longest dialling code first, so +353 isn't read as +35…
    const match = [...COUNTRIES]
      .sort((a, b) => b[2].length - a[2].length)
      .find(([, , dial]) => digits.startsWith(dial));
    if (match) return { iso: match[0], national: digits.slice(match[2].length) };
  }
  return { iso: fallbackIso, national: v };
}

/**
 * Phone number with a country-code picker (UK by default). The value it
 * reports is international — "+44 7700900123" — so SMS and WhatsApp always
 * reach the right country; a leading 0 typed out of habit is dropped.
 */
export default function PhoneInput({
  value,
  onChange,
  placeholder = "Phone number",
  className,
  inputClassName,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}) {
  const [iso, setIso] = useState(() => parse(value, "GB").iso);
  const [national, setNational] = useState(() => parse(value, "GB").national);
  const dial = COUNTRIES.find((c) => c[0] === iso)?.[2] ?? "44";

  // Refill from outside (a resumed checkout, a cleared form) without fighting
  // the person typing: only re-parse when the value isn't what we'd produce.
  useEffect(() => {
    if (value === compose(dial, national)) return;
    const p = parse(value, iso);
    setIso(p.iso);
    setNational(p.national);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div
      className={cn(
        "flex w-full items-stretch overflow-hidden rounded-xl border border-gray-200 bg-white focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/10",
        className
      )}
    >
      <label className="relative flex shrink-0 items-center border-r border-gray-200 bg-gray-50 pl-3 pr-7 text-[15px] text-ink-950">
        <span aria-hidden>
          {flag(iso)} +{dial}
        </span>
        <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute right-2 h-4 w-4 text-gray-400" fill="currentColor">
          <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
        </svg>
        <select
          aria-label="Country code"
          value={iso}
          onChange={(e) => {
            const next = e.target.value;
            setIso(next);
            onChange(compose(COUNTRIES.find((c) => c[0] === next)?.[2] ?? "44", national));
          }}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {COUNTRIES.map(([code, name, d]) => (
            <option key={code} value={code}>
              {flag(code)} {name} (+{d})
            </option>
          ))}
        </select>
      </label>
      <div className="relative min-w-0 flex-1">
        <Phone className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={national}
          placeholder={placeholder}
          onChange={(e) => {
            setNational(e.target.value);
            onChange(compose(dial, e.target.value));
          }}
          className={cn(
            "w-full bg-transparent py-3.5 pl-11 pr-4 text-[15px] outline-none placeholder:text-gray-400",
            inputClassName
          )}
        />
      </div>
    </div>
  );
}
