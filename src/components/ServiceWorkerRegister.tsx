"use client";

import { useEffect } from "react";

/** Registers the PWA service worker in production only (avoids dev cache issues). */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* ignore registration errors */
    });
  }, []);
  return null;
}
