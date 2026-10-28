"use client";

import Link from "next/link";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Mail, Lock, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/Brand";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";

function LoginForm({ title, subtitle }: { title: string; subtitle: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"password" | "code">("password");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const need = params.get("need");
  const idle = params.get("idle");

  /**
   * Signed in with a password: ask the server what is still owed for
   * two-factor sign-in, then go on — code step, set-up page, or home.
   */
  const proceed = async (fresh: boolean) => {
    const st = await fetch("/api/auth/two-factor", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (!st?.signedIn) {
      setLoading(false);
      return;
    }
    if (!st.active) {
      setLoading(false);
      setError("Your account is not active. Contact an admin.");
      await supabase.auth.signOut();
      return;
    }
    const wanted = params.get("next");
    const next = wanted && wanted.startsWith("/") && !wanted.startsWith("//") && (st.owner ? wanted.startsWith("/master") : !wanted.startsWith("/master")) ? wanted : st.home;
    if (st.block === "code") {
      setStep("code");
      setLoading(false);
      return;
    }
    if (st.block === "setup") {
      router.push(`/security?next=${encodeURIComponent(next)}`);
      return;
    }
    if (fresh && !st.owner) await logActivity(supabase, "login", "Signed in to the dashboard");
    // Still in their 3 days to set up two-factor sign-in: ask at every sign-in.
    if (fresh && st.graceUntil) {
      router.push(`/security?next=${encodeURIComponent(next)}&grace=1`);
      return;
    }
    router.push(next);
    router.refresh();
  };

  // Already signed in (e.g. the installed app re-opened on /login, or a page
  // sent them back here for their authenticator code)? Carry on from there.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      await proceed(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      setLoading(false);
      setError("Invalid email or password.");
      return;
    }
    setPassword("");
    await proceed(true);
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp?.[0];
    if (!factor) {
      setLoading(false);
      setError("No authenticator found on this account. Ask your administrator to reset it.");
      return;
    }
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.replace(/\s/g, "") });
    if (error) {
      setLoading(false);
      setCode("");
      setError("That code didn't work. Check the time on your phone and try the newest code.");
      return;
    }
    await proceed(true);
  };

  const useOtherAccount = async () => {
    await supabase.auth.signOut();
    setStep("password");
    setCode("");
    setError(null);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50/60 to-white p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm"
      >
        <div className="mb-8 text-center">
          <Logo height={52} className="mx-auto mb-6 h-auto w-[250px] max-w-full" />
          <h1 className="font-display text-2xl font-bold text-ink-950">{title}</h1>
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        </div>

        {idle && (
          <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
            You were signed out because the screen was left without activity. Please sign in again.
          </div>
        )}

        {need && (
          <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
            This area needs a <b className="capitalize">{need}</b> account. Please sign in with the right account.
          </div>
        )}

        {step === "code" ? (
          <form onSubmit={verifyCode} className="space-y-4 rounded-3xl border border-gray-100 bg-white p-6 shadow-xl shadow-gray-200/60">
            <div className="flex items-center gap-2 font-semibold text-ink-950">
              <ShieldCheck className="h-5 w-5 text-brand-600" /> Two-factor sign-in
            </div>
            <p className="text-sm text-gray-600">Open your authenticator app and type the 6-digit code for this account.</p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
              placeholder="123 456"
              className="w-full rounded-xl border border-gray-200 bg-white py-3.5 text-center font-mono text-2xl tracking-[0.3em] outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading || code.replace(/\s/g, "").length !== 6}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 py-3.5 font-semibold text-white shadow-lg shadow-brand-500/30 transition-all hover:bg-brand-600 disabled:bg-gray-200"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Verify"}
            </button>
            <button type="button" onClick={useOtherAccount} className="w-full text-center text-sm text-gray-500 hover:text-ink-950">
              Use a different account
            </button>
          </form>
        ) : (
        <form
          onSubmit={signIn}
          className="space-y-4 rounded-3xl border border-gray-100 bg-white p-6 shadow-xl shadow-gray-200/60"
        >
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full rounded-xl border border-gray-200 bg-white py-3.5 pl-11 pr-4 text-[15px] outline-none placeholder:text-gray-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10"
            />
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-xl border border-gray-200 bg-white py-3.5 pl-11 pr-4 text-[15px] outline-none placeholder:text-gray-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 py-3.5 font-semibold text-white shadow-lg shadow-brand-500/30 transition-all hover:bg-brand-600 disabled:bg-gray-200"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (<><LogIn className="h-5 w-5" /> Sign In</>)}
          </button>
          <p className="text-center text-sm">
            <Link href="/auth/forgot" className="text-gray-500 hover:text-ink-950">
              Forgot your password?
            </Link>
          </p>
        </form>
        )}
      </motion.div>
    </main>
  );
}

/**
 * Email + password sign-in, shared by the staff app (/login) and the driver
 * app (/driver/login). Whoever signs in lands on their own role's home.
 */
export default function SignIn({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-white">
          <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
        </main>
      }
    >
      <LoginForm title={title} subtitle={subtitle} />
    </Suspense>
  );
}
