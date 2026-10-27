import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disabled to avoid a dev-only deadlock between React 19 StrictMode's
  // double-invocation and framer-motion's AnimatePresence (mode="wait").
  reactStrictMode: false,

  // Security headers on every page and API. Only the booking widget
  // (/embed/<company>) may be shown inside another website's frame — it is
  // made to be put on companies' own sites; everything else (dashboards,
  // sign-in, master) refuses to be framed, so it can't be click-jacked.
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(self)" },
        ],
      },
      {
        source: "/((?!embed/).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
