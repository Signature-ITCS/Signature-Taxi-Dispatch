import Image from "next/image";
import { BRAND } from "@/lib/brand";

/** The "ST" lettermark — for app bars, sidebars and small spaces. */
export function LogoMark({ size = 36, className }: { size?: number; className?: string }) {
  return <Image src={BRAND.logoMark} alt={BRAND.name} width={size} height={size} className={className} priority />;
}

/** The name as text (no logo image). Light backgrounds only. */
export function Logo({ height = 40, className }: { height?: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label={BRAND.name}
      className={`block text-center leading-none ${className ?? ""}`}
      style={{ height: "auto" }}
    >
      <span className="block font-serif font-bold text-ink-950" style={{ fontSize: Math.round(height * 0.62) }}>
        Signature
      </span>
      <span
        className="mt-1 block font-semibold uppercase tracking-[0.35em] text-brand-600"
        style={{ fontSize: Math.round(height * 0.26) }}
      >
        Transfers
      </span>
    </span>
  );
}
