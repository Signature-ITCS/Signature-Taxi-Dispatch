"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CircleDot, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface Me {
  full_name: string;
  status: "pending" | "active" | "disabled";
  kind: string;
  council: string;
  badge_number: string;
  badge_expires: string;
  vehicle_licence_expires: string | null;
  operator_licence_expires: string | null;
  phone: string;
  areas: string;
  about: string | null;
  available: boolean;
  available_until: string | null;
  paid_until: string | null;
}

const day = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

/** A partner-network driver's own page: whether companies can see them, and "available now". */
export default function PartnerPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [hidden, setHidden] = useState<string | null>(null);
  const [areas, setAreas] = useState("");
  const [phone, setPhone] = useState("");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/partner/me", { cache: "no-store" });
    if (r.status === 403) {
      router.replace("/login?next=/partner");
      return;
    }
    const d = await r.json().catch(() => null);
    if (!d?.ok) return;
    setMe(d.partner);
    setHidden(d.hidden_because);
    setAreas(d.partner.areas ?? "");
    setPhone(d.partner.phone ?? "");
    setAbout(d.partner.about ?? "");
  }, [router]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (key: string, body: Record<string, unknown>, okText: string) => {
    setBusy(key);
    setMsg(null);
    const d = await fetch("/api/partner/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .catch(() => null);
    setBusy(null);
    if (d?.ok) {
      setMsg({ ok: true, text: okText });
      await load();
    } else setMsg({ ok: false, text: d?.error === "invalid_phone" ? "Enter a valid mobile number." : "That didn't work." });
  };

  if (!me) return <main className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-500" /></main>;

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold text-ink-950">Hello, {me.full_name.split(" ")[0]}</h1>
          <button onClick={async () => { await createClient().auth.signOut(); router.replace("/login"); }} className="flex items-center gap-1 text-sm text-gray-500">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>

        {msg && <p className={`rounded-xl p-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}

        <section className={`rounded-3xl border p-5 ${hidden ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
          {hidden ? (
            <p className="text-sm text-amber-900">
              <strong>Companies can&apos;t see you right now</strong> — {hidden}.{" "}
              {hidden === "not paid up" ? "Pay the link we send you each month to be listed again." : "Contact us if this isn't right."}
            </p>
          ) : (
            <p className="text-sm text-emerald-900"><strong>You&apos;re listed.</strong> Licensed companies on the platform can find you. Paid until {day(me.paid_until)}.</p>
          )}
        </section>

        <section className="space-y-3 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="flex items-center gap-2 font-semibold text-ink-950">
            <CircleDot className={`h-5 w-5 ${me.available ? "text-emerald-500" : "text-gray-300"}`} /> {me.available ? "Available for work" : "Not available"}
          </p>
          <p className="text-sm text-gray-600">
            Switch this on when you can take jobs — companies see you at the top of the list. It switches itself off after 12 hours.
          </p>
          <button
            onClick={() => save("avail", { available: !me.available }, me.available ? "You're shown as not available." : "You're shown as available.")}
            disabled={!!busy || me.status !== "active"}
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-60 ${me.available ? "bg-gray-700" : "bg-emerald-600"}`}
          >
            {busy === "avail" && <Loader2 className="h-4 w-4 animate-spin" />} {me.available ? "I'm not available now" : "I'm available now"}
          </button>
        </section>

        <section className="space-y-3 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm text-sm">
          <h2 className="font-semibold text-ink-950">Your details</h2>
          <label className="block">Areas you cover<input value={areas} onChange={(e) => setAreas(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2" /></label>
          <label className="block">Mobile / WhatsApp<input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2" /></label>
          <label className="block">About you<textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2" /></label>
          <button onClick={() => save("details", { areas, phone, about }, "Saved.")} disabled={!!busy} className="rounded-xl bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-60">
            {busy === "details" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </button>
          <div className="space-y-1 border-t border-gray-100 pt-3 text-gray-600">
            <p>Licensing council: {me.council}</p>
            <p>Badge {me.badge_number} — expires {day(me.badge_expires)}</p>
            {me.vehicle_licence_expires && <p>Vehicle licence expires {day(me.vehicle_licence_expires)}</p>}
            {me.operator_licence_expires && <p>Operator licence expires {day(me.operator_licence_expires)}</p>}
            <p className="text-xs text-gray-400">To change licence or vehicle details, contact us with the new documents.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
