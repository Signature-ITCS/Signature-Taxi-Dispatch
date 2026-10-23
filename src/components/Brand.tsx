import Image from "next/image";
import { BRAND } from "@/lib/brand";

/** The logo mark on its own — for app bars, sidebars and small spaces. */
export function LogoMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <Image
      src={BRAND.logoMark}
      alt={BRAND.name}
      width={Math.round(size * (292 / 256))}
      height={size}
      className={className}
      priority
    />
  );
}

/** Full wordmark — mark + "CHEAP TRANSFERS". Light backgrounds only. */
export function Logo({ height = 40, className }: { height?: number; className?: string }) {
  return (
    <Image
      src={BRAND.logo}
      alt={BRAND.name}
      width={Math.round(height * (340 / 70))}
      height={height}
      className={className}
      priority
    />
  );
}
