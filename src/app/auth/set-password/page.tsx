"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Loader2, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Choose a password — reached from the welcome or reset email, already signed
 * in by the one-time link. Then on to the right screens for who they are.
 */
export default function SetPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Created in the browser only (never while the page is pre-rendered).
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        setEmail(data.user?.email ?? null);
        setChecking(false);
      });
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw.length < 10) return setError("Use at least 10 characters.");
    if (pw !== pw2) return setError("The two passwords don't match.");
    setBusy(true);
    const { error: err } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (err) return setError(err.message || "Couldn't save the password. Try again.");
    setDone(true);
    // "/" sends each person to their own area (owner, admin, dispatcher, driver).
    // The sign-in page sends them on: dashboard, two-factor set-up, or partner page.
    setTimeout(() => router.replace("/login"), 1200);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm rounded-3xl border border-gray-100 bg-white p-6 shadow-xl shadow-gray-200/60">
        {checking ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
          </div>
        ) : !email ? (
          <div className="text-center">
            <h1 className="font-display text-xl font-bold text-ink-950">This link has expired</h1>
            <p className="mt-2 text-sm text-gray-500">Ask for a new one — it only takes a moment.</p>
            <Link href="/auth/forgot" className="mt-5 inline-block rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white">
              Send me a new link
            </Link>
          </div>
        ) : done ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="mt-3 font-semibold text-ink-950">Password saved</p>
            <p className="mt-1 text-sm text-gray-500">Taking you in…</p>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50">
                <Lock className="h-5 w-5 text-brand-600" />
              </div>
              <h1 className="font-display text-xl font-bold text-ink-950">Choose your password</h1>
              <p className="mt-1 text-sm text-gray-500">{email}</p>
            </div>
            <input
              type="password"
              autoComplete="new-password"
              placeholder="New password (10+ characters)"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Type it again"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save password
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
