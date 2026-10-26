import Link from "next/link";
import { MailCheck } from "lucide-react";

export const metadata = { title: "Thanks for signing up" };

/** After signing up: the account waits for the platform owner's approval. */
export default function SignupDonePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50/60 to-white p-4">
      <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-xl shadow-gray-200/60">
        <MailCheck className="mx-auto h-12 w-12 text-brand-600" />
        <h1 className="mt-4 font-display text-2xl font-bold text-ink-950">Thanks — we&apos;ve got your details</h1>
        <p className="mt-2 text-sm text-gray-600">
          We check every new account. Once yours is approved you&apos;ll get an email with a button to choose your password
          and sign in — usually within one working day.
        </p>
        <p className="mt-4 text-xs text-gray-400">Nothing after a day? Check your spam folder, or contact us.</p>
        <Link href="/" className="mt-6 inline-block rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-ink-950">
          Back to the home page
        </Link>
      </div>
    </main>
  );
}
