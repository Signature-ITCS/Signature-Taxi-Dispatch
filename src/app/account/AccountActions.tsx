"use client";

import HelpLink from "@/components/docs/HelpLink";
import { useState } from "react";
import { CreditCard, LifeBuoy, History, Loader2, CheckCircle2 } from "lucide-react";
import type { SetupPackage } from "@/lib/services";

/** Billing portal, "We'll set it up for you", and (plans without it) a paid restore. */
export default function AccountActions({
  hasBilling,
  supportEmail,
  packages,
  restorePrice,
  backupsIncluded,
  requested,
  unpaid,
}: {
  hasBilling: boolean;
  supportEmail: string;
  packages: SetupPackage[];
  restorePrice: number;
  backupsIncluded: boolean;
  requested: string | null;
  unpaid: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(requested && !unpaid ? requested : null);
  const [details, setDetails] = useState("");
  const [restoreDate, setRestoreDate] = useState("");

  const go = async (key: string, url: string, body?: unknown) => {
    setBusy(key);
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (data?.ok && data.url) {
      window.location.href = data.url;
      return;
    }
    setBusy(null);
    if (data?.ok) setSent(key.startsWith("setup") ? "setup" : "restore");
    else setError("That didn't work. Please try again" + (supportEmail ? `, or email ${supportEmail}.` : "."));
  };

  return (
    <div className="space-y-5">
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {sent && (
        <p className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> Request received — we&apos;ll be in touch by email.
        </p>
      )}
      {unpaid && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Your request is saved but not paid yet — we&apos;ll contact you.</p>}

      <section className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink-950">
          <CreditCard className="h-5 w-5 text-brand-600" /> Billing <span className="ml-auto"><HelpLink to="plan-billing#manage" /></span>
        </h2>
        {hasBilling ? (
          <>
            <p className="mt-1 text-sm text-gray-600">Change plan, update your card, download invoices or cancel — on Stripe&apos;s secure page.</p>
            <button
              onClick={() => go("portal", "/api/account/portal")}
              disabled={!!busy}
              className="mt-4 flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy === "portal" && <Loader2 className="h-4 w-4 animate-spin" />} Manage billing
            </button>
          </>
        ) : (
          <p className="mt-1 text-sm text-gray-600">
            Your plan is managed by us. To change it, {supportEmail ? <>email <a className="text-brand-600" href={`mailto:${supportEmail}`}>{supportEmail}</a></> : "contact us"}.
          </p>
        )}
      </section>

      <section className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink-950">
          <LifeBuoy className="h-5 w-5 text-brand-600" /> We&apos;ll set it up for you <span className="ml-auto"><HelpLink to="setup-help" /></span>
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Don&apos;t want to deal with payment, email or SMS settings? Choose a package and we&apos;ll do it. Never send us
          passwords by email — we&apos;ll arrange access with you.
        </p>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Anything we should know (your website, best time to call…)"
          className="mt-3 w-full rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-brand-500"
          rows={2}
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {packages.map((p) => (
            <div key={p.code} className="flex flex-col rounded-2xl border border-gray-100 p-4">
              <p className="font-semibold text-ink-950">
                {p.name} {p.price > 0 && <span className="text-brand-600">· £{p.price}</span>}
              </p>
              <p className="mt-1 flex-1 text-sm text-gray-600">{p.description}</p>
              <button
                onClick={() => go(`setup-${p.code}`, "/api/account/request", { kind: "setup", package: p.code, details })}
                disabled={!!busy}
                className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-gray-200 py-2 text-sm font-semibold text-ink-950 hover:border-brand-500 disabled:opacity-60"
              >
                {busy === `setup-${p.code}` && <Loader2 className="h-4 w-4 animate-spin" />} {p.price > 0 ? "Choose and pay" : "Request"}
              </button>
            </div>
          ))}
        </div>
      </section>

      {!backupsIncluded && (
        <section className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink-950">
            <History className="h-5 w-5 text-brand-600" /> Restore your data <span className="ml-auto"><HelpLink to="backups#restore" /></span>
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Lost or changed something by mistake? We can put your data back to how it was on an earlier day
            {restorePrice ? ` for £${restorePrice}` : ""}. Money already taken and messages already sent can&apos;t be undone.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              type="date"
              value={restoreDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setRestoreDate(e.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
            <button
              onClick={() => go("restore", "/api/account/request", { kind: "restore", backup_date: restoreDate, details })}
              disabled={!!busy || !restoreDate}
              className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-ink-950 disabled:opacity-60"
            >
              {busy === "restore" && <Loader2 className="h-4 w-4 animate-spin" />} Request a restore
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
