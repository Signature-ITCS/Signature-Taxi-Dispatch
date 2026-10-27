"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";

interface PlanOption {
  code: string;
  name: string;
  price: number;
  trialDays: number;
}

const ERRORS: Record<string, string> = {
  missing_fields: "Fill in your company name, your name and a valid email.",
  email_in_use: "That email already has an account. Sign in instead, or use another email.",
  unknown_plan: "Choose a plan.",
  rate_limited: "Too many attempts. Try again in a little while.",
  invalid_phone: "Enter a valid mobile / WhatsApp number — we send your invoices there.",
  create_failed: "We couldn't create your account. Please try again, or get in touch with us.",
};

export default function SignupForm({
  platformName,
  plans,
  initialPlan,
}: {
  platformName: string;
  plans: PlanOption[];
  initialPlan: string;
}) {
  const [plan, setPlan] = useState(initialPlan);
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = plans.find((p) => p.code === plan);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (company.trim().length < 2 || name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setError(ERRORS.missing_fields);
    }
    setBusy(true);
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, company_name: company, full_name: name, email, phone }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (data?.ok && data.url) {
      window.location.href = data.url;
      return;
    }
    setBusy(false);
    setError(ERRORS[data?.error as string] ?? "Something went wrong. Please try again.");
  };

  return (
    <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-3xl border border-gray-100 bg-white p-6 shadow-xl shadow-gray-200/60">
      <div>
        <p className="text-sm font-semibold text-brand-600">{platformName}</p>
        <h1 className="font-display text-2xl font-bold text-ink-950">Create your company account</h1>
        {chosen && (
          <p className="mt-1 text-sm text-gray-500">
            {chosen.trialDays > 0
              ? `${chosen.trialDays} days free, then £${chosen.price.toFixed(0)} a month. Cancel any time.`
              : `£${chosen.price.toFixed(0)} a month. Cancel any time.`}
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {plans.map((p) => (
          <button
            type="button"
            key={p.code}
            onClick={() => setPlan(p.code)}
            className={`rounded-xl border px-2 py-2 text-center text-sm ${p.code === plan ? "border-brand-500 bg-brand-50 font-semibold text-brand-700" : "border-gray-200 text-gray-600"}`}
          >
            {p.name}
            <span className="block text-xs text-gray-500">£{p.price.toFixed(0)}/mo</span>
          </button>
        ))}
      </div>

      <label className="block text-sm">
        <span className="font-medium text-gray-700">Company name</span>
        <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="City Cars Ltd"
          className="mt-1 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 outline-none focus:border-brand-500" />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-gray-700">Your name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam Taylor" autoComplete="name"
          className="mt-1 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 outline-none focus:border-brand-500" />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-gray-700">Work email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sam@citycars.co.uk" autoComplete="email"
          className="mt-1 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 outline-none focus:border-brand-500" />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-gray-700">Mobile / WhatsApp</span>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 7700 900123" autoComplete="tel"
          className="mt-1 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 outline-none focus:border-brand-500" />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}{" "}
        Create my account
      </button>
      <p className="text-center text-xs text-gray-400">
        No payment now. We check every new account and email you a link to sign in once it&apos;s approved
        {chosen && chosen.trialDays > 0 ? " — your free trial starts then" : ""}. Later we send you a payment link each month by email or WhatsApp.
      </p>
      <p className="text-center text-sm">
        <Link href="/login" className="text-gray-500 hover:text-ink-950">Already have an account? Sign in</Link>
      </p>
    </form>
  );
}
