import type { Metadata } from "next";

/**
 * Staff screens install as their own app (start page /login), separate from
 * the customer booking app, so a phone never mixes the two. Each company's
 * installed apps carry its own name; with no company known (the shared sign-in
 * page) they carry neutral ones.
 */
const manifestUrl = (app: "staff" | "driver", slug: string | null | undefined) =>
  `/api/manifest/${app}${slug ? `?c=${encodeURIComponent(slug)}` : ""}`;

export function staffMetadataFor(companyName: string | null | undefined, slug?: string | null): Metadata {
  const title = companyName ? `${companyName} Dispatch` : "Dispatch";
  return {
    title,
    manifest: manifestUrl("staff", slug),
    appleWebApp: { title, capable: true, statusBarStyle: "default" },
  };
}

/** The driver app installs separately again (start page /driver). */
export function driverMetadataFor(companyName: string | null | undefined, slug?: string | null): Metadata {
  const title = companyName ? `${companyName} Driver` : "Driver";
  return {
    title,
    manifest: manifestUrl("driver", slug),
    appleWebApp: { title, capable: true, statusBarStyle: "black-translucent" },
  };
}

export const staffMetadata: Metadata = staffMetadataFor(null);
export const driverMetadata: Metadata = driverMetadataFor(null);
