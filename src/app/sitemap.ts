import type { MetadataRoute } from "next";
import { ALL_DOCS } from "@/content/docs";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://booking.airport-transfer.uk").replace(/\/$/, "");

/**
 * /sitemap.xml for search engines: the public pages only — home, sign-up and
 * the help pages (not the platform owner's own documentation). Dashboards,
 * sign-in pages, companies' booking pages and the partner join page are left
 * out on purpose.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/signup`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE}/documentation`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    ...ALL_DOCS.filter((p) => p.audience !== "owner").map((p) => ({
      url: `${SITE}/documentation/${p.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.4,
    })),
  ];
}
