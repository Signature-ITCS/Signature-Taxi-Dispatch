import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disabled to avoid a dev-only deadlock between React 19 StrictMode's
  // double-invocation and framer-motion's AnimatePresence (mode="wait").
  reactStrictMode: false,
};

export default nextConfig;
