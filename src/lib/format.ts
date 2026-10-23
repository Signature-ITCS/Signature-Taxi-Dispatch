import { CURRENCY_SYMBOL } from "./constants";

/** Format a number as GBP currency, e.g. 53 -> "£53.00". */
export function money(value: number | null | undefined): string {
  const n = typeof value === "number" ? value : 0;
  return `${CURRENCY_SYMBOL}${n.toFixed(2)}`;
}

/** Short "time ago" label, e.g. "3m ago". */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Every time in the app is shown the British way: 24-hour clock, day before
 * month, UK time.
 *
 * Both halves have to be stated. Leave the locale out and the browser decides,
 * so the same pickup reads "14:05" for a dispatcher in London and "2:05:00 PM"
 * on a US laptop. Leave the time zone out and the viewer's own clock decides,
 * so an owner working from abroad sees UK pickups shifted into local time and
 * could send a driver hours early. The server already pins Europe/London when
 * it writes emails and SMS; these keep every screen agreeing with them.
 *
 * `hourCycle: "h23"` rather than `hour12: false` — the latter can render
 * midnight as "24:00" instead of "00:00".
 */
const LOCALE = "en-GB";
const TZ = "Europe/London";
const TIME = { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ } as const;

/** Format a clock time, e.g. "14:05". */
export function clock(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(LOCALE, TIME);
}

/** Format a date + time, e.g. "23 Jul, 14:05". Use for historical timestamps. */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(LOCALE, { day: "2-digit", month: "short", ...TIME });
}

/** Date + time with the year, e.g. "22 Sep 2026, 14:05". For a scheduled pickup. */
export function dateTimeFull(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...TIME,
  });
}

/** Weekday + date + time, e.g. "Tue 22 Sep, 14:05". For the customer tracking page. */
export function dateTimeWithDay(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...TIME,
  });
}

/** Date only, e.g. "22 Sep 2026". */
export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  });
}

/** Loose phone check: 7–15 digits, optional leading "+". Rejects letters/junk. */
export function isValidPhone(v: string | null | undefined): boolean {
  if (!v) return false;
  const trimmed = v.trim();
  if (/[a-z]/i.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * Normalise a phone number to a bare international form for wa.me links
 * (digits only, no "+"). A leading national "0" is replaced with the country
 * code (default UK "44"); a "00" international prefix is stripped.
 */
export function normalizeWhatsapp(v: string | null | undefined, cc = "44"): string {
  let d = (v ?? "").trim();
  const hadPlus = d.startsWith("+");
  d = d.replace(/\D/g, "");
  if (!d) return "";
  if (hadPlus) return d;
  if (d.startsWith("00")) return d.slice(2);
  if (d.startsWith("0")) return cc + d.slice(1);
  return d;
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
