"use client";

import Link from "next/link";
import { Suspense, useRef, useState } from "react";
import Turnstile, { turnstileEnabled, type TurnstileHandle } from "@/components/Turnstile";
import { useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";

/** "Forgot your password?" — emails a one-time link to choose a new one. */
export default function ForgotPage() {
  return (
    <Suspense>
      <Forgot />
    </Suspense>
  );
}

function Forgot() {
  const expired = useSearchParams().get("expired");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const robot = useRef<TurnstileHandle>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter your email address.");
    if (turnstileEnabled && !token) return setError("Please complete the check below.");
    setBusy(true);
    setError(null);
    const d = await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), turnstile: token }),
    })
      .then((r) => r.json())
      .catch(() => null);
    setBusy(false);
    if (d?.error === "robot_check") {
      robot.current?.reset();
      return setError("The check didn't pass — please try again.");
    }
    // Same answer whether or not the address has an account.
    setSent(true);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm rounded-3xl border border-gray-100 bg-white p-6 shadow-xl shadow-gray-200/60">
        {sent ? (
          <div className="py-4 text-center">
            <MailCheck className="mx-auto h-10 w-10 text-brand-600" />
            <h1 className="mt-3 font-display text-xl font-bold text-ink-950">Check your email</h1>
            <p className="mt-2 text-sm text-gray-500">
              If <b>{email}</b> has an account, a link to choose a new password is on its way. It works once and expires after 24 hours.
            </p>
          </div>
        ) : (
          <form onSubmit={send} className="space-y-4">
            <div className="text-center">
              <h1 className="font-display text-xl font-bold text-ink-950">Forgot your password?</h1>
              <p className="mt-1 text-sm text-gray-500">
                {expired ? "That link has expired or was already used. " : ""}We&apos;ll email you a link to choose a new one.
              </p>
            </div>
            <input
              type="email"
              autoComplete="email"
              placeholder="you@company.co.uk"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
            />
            <Turnstile ref={robot} onToken={setToken} />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Send the link
            </button>
            <p className="text-center text-sm">
              <Link href="/login" className="text-gray-500 hover:text-ink-950">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
