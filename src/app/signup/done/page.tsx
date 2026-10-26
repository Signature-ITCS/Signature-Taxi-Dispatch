import Link from "next/link";
import { MailCheck } from "lucide-react";

export const metadata = { title: "Check your email" };

/** After signing up for a free trial (the account is made straight away). */
export default function SignupDonePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50/60 to-white p-4">
      <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-xl shadow-gray-200/60">
        <MailCheck className="mx-auto h-12 w-12 text-brand-600" />
        <h1 className="mt-4 font-display text-2xl font-bold text-ink-950">You&apos;re in — check your email</h1>
        <p className="mt-2 text-sm text-gray-600">
          We&apos;re setting up your account now. In a minute you&apos;ll get an email with a button to choose your password
          and sign in.
        </p>
        <p className="mt-4 text-xs text-gray-400">Nothing after a few minutes? Check your spam folder, or contact us.</p>
        <Link href="/login" className="mt-6 inline-block rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-ink-950">
          Go to sign in
        </Link>
      </div>
    </main>
  );
}
