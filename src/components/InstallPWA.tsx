"use client";

import { useEffect, useState } from "react";
import { Download, Share } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * "Install app" prompt. Browsers don't let a link/email auto-install a PWA, so
 * this offers a one-tap install where supported (Chrome/Edge/Android via the
 * beforeinstallprompt event) and shows an Add-to-Home-Screen hint on iOS.
 */
export default function InstallPWA() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    const nav = navigator as Navigator & { standalone?: boolean };
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
    if (standalone) setInstalled(true);
    else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) setIosHint(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  };

  if (installed) return null;

  if (deferred) {
    return (
      <button
        onClick={install}
        className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-3 font-semibold text-ink-950 transition-colors hover:bg-gray-50"
      >
        <Download className="h-5 w-5 text-brand-500" /> Install app
      </button>
    );
  }

  if (iosHint) {
    return (
      <p className="mt-2.5 flex items-center justify-center gap-1.5 rounded-xl bg-gray-50 px-3 py-2.5 text-center text-xs text-gray-500">
        <Share className="h-3.5 w-3.5 shrink-0" /> Tap Share, then “Add to Home Screen” to install the app.
      </p>
    );
  }

  return null;
}
