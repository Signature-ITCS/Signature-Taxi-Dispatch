import type { MetadataRoute } from "next";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://booking.airport-transfer.uk").replace(/\/$/, "");

/**
 * /robots.txt: search engines may read the public pages and are pointed at
 * the sitemap; dashboards, sign-in, accounts and the API are off limits
 * (they need a login anyway — this just keeps them out of search results).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/", "/admin", "/dispatch", "/master", "/account", "/security", "/partner", "/partners/",
        "/driver", "/login", "/auth/", "/track/", "/booking/", "/print/", "/install/", "/embed/",
      ],
    },
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
