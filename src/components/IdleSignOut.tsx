"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const KEY = "last-activity";
const WARN_MS = 60_000;

const now = () => Date.now();
const readLast = () => {
  try {
    return Number(localStorage.getItem(KEY)) || now();
  } catch {
    return now();
  }
};
const writeLast = (t: number) => {
  try {
    localStorage.setItem(KEY, String(t));
  } catch {
    /* private mode: this tab's own timer still works */
  }
};

/**
 * Signs an unattended screen out after `minutes` without any mouse, keyboard
 * or touch activity — shared across tabs, so working in one tab keeps the
 * others signed in. A minute before, it offers "Stay signed in". Protects
 * shared office computers left logged in.
 */
export default function IdleSignOut({ minutes }: { minutes: number }) {
  const [warn, setWarn] = useState(false);

  useEffect(() => {
    const limit = minutes * 60_000;
    let last = now();
    writeLast(last);
    let lastWrite = 0;
    const activity = () => {
      last = now();
      // Don't hammer storage on every mouse move.
      if (last - lastWrite > 15_000) {
        writeLast(last);
        lastWrite = last;
      }
      setWarn(false);
    };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, activity, { passive: true }));

    const tick = setInterval(async () => {
      const idle = now() - Math.max(last, readLast());
      if (idle >= limit) {
        clearInterval(tick);
        try {
          await createClient().auth.signOut();
        } finally {
          window.location.assign("/login?idle=1");
        }
      } else setWarn(idle >= limit - WARN_MS);
    }, 15_000);

    return () => {
      clearInterval(tick);
      events.forEach((e) => window.removeEventListener(e, activity));
    };
  }, [minutes]);

  if (!warn) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex justify-center p-3">
      <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg">
        You&apos;ll be signed out in a minute because nothing has happened on this screen.
        <button
          onClick={() => {
            writeLast(now());
            setWarn(false);
          }}
          className="rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white"
        >
          Stay signed in
        </button>
      </div>
    </div>
  );
}
