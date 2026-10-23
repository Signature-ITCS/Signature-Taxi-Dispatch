"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Mail, Lock, Loader2, LogIn } from "lucide-react";
import { Logo } from "@/components/Brand";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";

const HOME: Record<string, string> = {
  admin: "/admin",
  dispatcher: "/dispatch",
  driver: "/driver",
};

function LoginForm({ title, subtitle }: { title: string; subtitle: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const need = params.get("need");

  // Already signed in (e.g. the installed app re-opened on /login)? Skip the
  // form and go straight to the right board.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      // The platform owner has no company profile — their screens are /master.
      const { data: isOwner } = await supabase.rpc("is_platform_admin");
      if (cancelled) return;
      if (isOwner) {
        router.replace("/master");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_active")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled || !profile?.is_active) return;
      router.replace(params.get("next") || HOME[profile.role] || "/");
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

    const { data: isOwner } = await supabase.rpc("is_platform_admin");
    if (isOwner) {
      router.push("/master");
      router.refresh();
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, is_active")
      .eq("id", data.user.id)
      .maybeSingle();

    if (!profile || !profile.is_active) {
      setLoading(false);
      setError("Your account is not active. Contact an admin.");
      await supabase.auth.signOut();
      return;
    }

    await logActivity(supabase, "login", "Signed in to the dashboard");

    const next = params.get("next") || HOME[profile.role] || "/";
    router.push(next);
    router.refresh();
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

        {need && (
          <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
            This area needs a <b className="capitalize">{need}</b> account. Please sign in with the right account.
          </div>
        )}

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
        </form>
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
