import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

/**
 * Staff screens install as their own app (start page /login), separate from
 * the customer booking app (start page /book), so a phone never mixes the two.
 */
export const staffMetadata: Metadata = {
  title: BRAND.staffAppName,
  manifest: "/staff.webmanifest",
  appleWebApp: { title: BRAND.staffAppName, capable: true, statusBarStyle: "default" },
};

/** The driver app installs separately again (start page /driver). */
export const driverMetadata: Metadata = {
  title: BRAND.driverAppName,
  manifest: "/driver.webmanifest",
  appleWebApp: { title: BRAND.driverAppName, capable: true, statusBarStyle: "black-translucent" },
};
