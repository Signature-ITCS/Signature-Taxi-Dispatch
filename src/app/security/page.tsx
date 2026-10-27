"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck, Loader2, Smartphone, Trash2, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface Status {
  signedIn: boolean;
  email: string | null;
  owner: boolean;
  role: string | null;
  enrolled: boolean;
  verified: boolean;
  required: boolean;
  block: null | "code" | "setup";
  companyRequires: boolean;
  canRequire: boolean;
  home: string;
}

export default function SecurityPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-500" /></main>}>
      <Security />
    </Suspense>
  );
}

/**
 * Two-factor sign-in with an authenticator app (Google / Microsoft
 * Authenticator, Authy, 1Password…): set it up, confirm it, remove it — and,
 * for company admins, require it for all office staff.
 */
function Security() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();
  const [st, setSt] = useState<Status | null>(null);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const wanted = params.get("next");
  const load = useCallback(async () => {
    const s = (await fetch("/api/auth/two-factor", { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as Status | null;
    if (!s?.signedIn) {
      router.replace("/login?next=/security");
      return null;
    }
    setSt(s);
    return s;
  }, [router]);
  useEffect(() => {
    load();
  }, [load]);

  const next = (s: Status) => (wanted && wanted.startsWith("/") && !wanted.startsWith("//") ? wanted : s.home);

  const start = async () => {
    setBusy("start");
    setMsg(null);
    // Throw away any set-up that was started but never confirmed.
    const { data: all } = await supabase.auth.mfa.listFactors();
    for (const f of all?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      issuer: window.location.hostname,
    });
    setBusy(null);
    if (error || !data) return setMsg({ ok: false, text: "Couldn't start the set-up. Please try again." });
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };

  const confirmCode = async (factorId: string) => {
    setBusy("verify");
    setMsg(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, "") });
    setBusy(null);
    setCode("");
    if (error) return setMsg({ ok: false, text: "That code didn't work. Check the time on your phone and try the newest code." });
    setEnroll(null);
    const s = await load();
    if (s && !s.block) {
      setMsg({ ok: true, text: "Two-factor sign-in is on. You'll be asked for a code from the app each time you sign in." });
      if (wanted) setTimeout(() => router.push(next(s)), 1200);
    }
  };

  const verifyExisting = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    const f = data?.totp?.[0];
    if (f) await confirmCode(f.id);
  };

  const remove = async () => {
    if (!st) return;
    const warn = st.required
      ? "Two-factor sign-in is required for your account. After removing it you'll have to set up a new authenticator before you can carry on. Remove it?"
      : "Remove two-factor sign-in? Your account will be protected by your password only.";
    if (!window.confirm(warn)) return;
    setBusy("remove");
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of data?.all ?? []) await supabase.auth.mfa.unenroll({ factorId: f.id });
    await supabase.auth.refreshSession();
    setBusy(null);
    await load();
    setMsg({ ok: true, text: "Two-factor sign-in removed." });
  };

  const setRequire = async (require: boolean) => {
    setBusy("require");
    setMsg(null);
    const d = await fetch("/api/auth/two-factor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ require }) })
      .then((r) => r.json())
      .catch(() => null);
    setBusy(null);
    if (d?.ok) {
      await load();
      setMsg({ ok: true, text: require ? "Now required for every admin and dispatcher. Anyone without an authenticator is asked to set one up next time." : "No longer required." });
    } else setMsg({ ok: false, text: d?.error === "set_up_yours_first" ? "Set up your own authenticator first." : "That didn't work." });
  };

  if (!st) return <main className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-500" /></main>;

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="mx-auto max-w-xl space-y-5">
        {!st.block && (
          <a href={next(st)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-ink-950">
            <ArrowLeft className="h-4 w-4" /> Back
          </a>
        )}
        <section className="space-y-4 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-ink-950">
            <ShieldCheck className="h-6 w-6 text-brand-600" /> Two-factor sign-in
          </h1>
          <p className="text-sm text-gray-600">
            Signed in as <strong>{st.email}</strong>. With two-factor sign-in, a stolen password alone can&apos;t get into your
            account: you also need the 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft
            Authenticator, Authy, 1Password…).
          </p>

          {st.block === "setup" && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              {st.owner ? "The master dashboard requires two-factor sign-in." : "Your company requires two-factor sign-in for office staff."} Set it
              up below to carry on.
            </p>
          )}
          {msg && <p className={`rounded-xl p-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}

          {st.role === "driver" && !st.owner ? (
            <p className="text-sm text-gray-600">Two-factor sign-in isn&apos;t used for driver accounts.</p>
          ) : st.enrolled && st.verified ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                <ShieldCheck className="h-4 w-4" /> On — your account asks for a code at every sign-in.
              </p>
              <button onClick={remove} disabled={!!busy} className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-60">
                {busy === "remove" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Remove / replace authenticator
              </button>
            </div>
          ) : st.enrolled ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">Enter the code from your authenticator app to confirm it&apos;s you.</p>
              <CodeInput code={code} setCode={setCode} />
              <button onClick={verifyExisting} disabled={!!busy || code.replace(/\s/g, "").length !== 6}
                className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {busy === "verify" && <Loader2 className="h-4 w-4 animate-spin" />} Verify
              </button>
            </div>
          ) : enroll ? (
            <div className="space-y-4">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-700">
                <li>Open your authenticator app and add a new account.</li>
                <li>Scan this QR code (or type the key below).</li>
                <li>Type the 6-digit code the app shows.</li>
              </ol>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enroll.qr} alt="QR code for your authenticator app" className="mx-auto h-48 w-48 rounded-xl border border-gray-100 bg-white p-2" />
              <p className="break-all rounded-xl bg-gray-50 p-3 text-center font-mono text-xs text-gray-700">{enroll.secret}</p>
              <CodeInput code={code} setCode={setCode} />
              <button onClick={() => confirmCode(enroll.id)} disabled={!!busy || code.replace(/\s/g, "").length !== 6}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white disabled:opacity-60">
                {busy === "verify" && <Loader2 className="h-4 w-4 animate-spin" />} Turn on two-factor sign-in
              </button>
            </div>
          ) : (
            <button onClick={start} disabled={!!busy} className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />} Set up an authenticator app
            </button>
          )}
        </section>

        {st.canRequire && !st.block && (
          <section className="space-y-3 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="font-display text-lg font-bold text-ink-950">Your company</h2>
            <p className="text-sm text-gray-600">
              Require two-factor sign-in for every admin and dispatcher in your company. Anyone without an authenticator is asked
              to set one up the next time they sign in. Drivers are not affected.
            </p>
            <label className="flex items-center gap-3 text-sm font-medium text-ink-950">
              <input type="checkbox" checked={st.companyRequires} disabled={!!busy} onChange={(e) => setRequire(e.target.checked)} className="h-4 w-4 accent-brand-600" />
              Require two-factor sign-in for office staff
            </label>
          </section>
        )}
        <p className="text-center text-xs text-gray-400">Lost your phone? Ask us (the platform owner) to reset your two-factor sign-in.</p>
      </div>
    </main>
  );
}

function CodeInput({ code, setCode }: { code: string; setCode: (v: string) => void }) {
  return (
    <input
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={7}
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
      placeholder="123 456"
      className="w-full rounded-xl border border-gray-200 py-3 text-center font-mono text-2xl tracking-[0.3em] outline-none focus:border-brand-500"
    />
  );
}
