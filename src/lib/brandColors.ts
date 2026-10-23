/**
 * A company's colour scale as CSS variables, overriding the defaults in
 * globals.css (--color-brand-50…900 from its main colour, --color-ink-600…950
 * from its dark colour). Pure — used on the server and in the browser.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;
export const DEFAULT_PRIMARY = "#1d4ed8";
export const DEFAULT_DARK = "#0f172a";

/** t > 0 mixes toward white, t < 0 toward black. */
function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t)));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

const BRAND_SCALE: Record<number, number> = { 50: 0.93, 100: 0.82, 200: 0.64, 300: 0.42, 400: 0.2, 500: 0, 600: -0.12, 700: -0.27, 800: -0.42, 900: -0.52 };
const INK_SCALE: Record<number, number> = { 950: 0, 900: 0.05, 800: 0.11, 700: 0.15, 600: 0.22 };

/** { "--color-brand-500": "#…", … } — validated hex only, safe to inline. */
export function brandVars(primary: string | null | undefined, dark: string | null | undefined): Record<string, string> {
  const p = (primary && HEX.test(primary) ? primary : DEFAULT_PRIMARY).toLowerCase();
  const d = (dark && HEX.test(dark) ? dark : DEFAULT_DARK).toLowerCase();
  const out: Record<string, string> = {};
  for (const [k, t] of Object.entries(BRAND_SCALE)) out[`--color-brand-${k}`] = shade(p, t);
  for (const [k, t] of Object.entries(INK_SCALE)) out[`--color-ink-${k}`] = shade(d, t);
  return out;
}

/** The same, as a `:root { … }` rule for a <style> tag. */
export function brandCss(primary: string | null | undefined, dark: string | null | undefined): string {
  return `:root{${Object.entries(brandVars(primary, dark)).map(([k, v]) => `${k}:${v}`).join(";")}}`;
}
