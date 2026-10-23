"use client";

import { useBrand } from "@/components/BrandProvider";

/**
 * The company's logo — its uploaded image, or its name as text when it has
 * none. Plain <img>: logos are uploaded by each company to storage, so their
 * size and host are not known at build time.
 */

/** Square mark for app bars, sidebars and small spaces: the logo, or initials. */
export function LogoMark({ size = 36, className }: { size?: number; className?: string }) {
  const brand = useBrand();
  if (brand.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={brand.logoUrl}
        alt={brand.name}
        width={size}
        height={size}
        className={className}
        style={{ width: size, height: size, objectFit: "contain" }}
      />
    );
  }
  const initials =
    brand.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "•";
  return (
    <span
      aria-label={brand.name}
      className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-brand-600 font-display font-bold text-white ${className ?? ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initials}
    </span>
  );
}

/** Full logo for light backgrounds: the image, or the company name. */
export function Logo({ height = 40, className }: { height?: number; className?: string }) {
  const brand = useBrand();
  if (brand.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={brand.logoUrl}
        alt={brand.name}
        className={className}
        style={{ height, width: "auto", maxWidth: "100%", objectFit: "contain" }}
      />
    );
  }
  return (
    <span
      className={`block text-center font-display font-bold leading-tight text-ink-950 ${className ?? ""}`}
      style={{ fontSize: Math.round(height * 0.5) }}
    >
      {brand.name}
    </span>
  );
}
