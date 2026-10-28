"use client";

import { useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";

const ERRORS: Record<string, string> = {
  missing_fields: "Fill in your name, email, licensing council, badge number and areas.",
  invalid_phone: "Enter a valid mobile / WhatsApp number.",
  badge_expired: "Enter your driver licence (badge) expiry date — it must still be valid.",
  operator_details: "Enter your operator licence number and the council that issued it.",
  consent_needed: "Please tick the box to agree.",
  email_in_use: "That email already has an account or application.",
  rate_limited: "Too many attempts. Try again later.",
};

const field = "mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500";

export default function JoinForm({ platformName, price, councils }: { platformName: string; price: number; councils: string[] }) {
  const [f, setF] = useState({
    kind: "driver", full_name: "", email: "", phone: "", council: "", badge_number: "", badge_expires: "",
    vehicle_type: "Saloon", vehicle_make: "", vehicle_model: "", vehicle_colour: "", vehicle_seats: "4", plate_number: "",
    vehicle_licence_number: "", vehicle_licence_expires: "", operator_licence_number: "", operator_council: "", operator_licence_expires: "",
    areas: "", about: "",
  });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const d = await fetch("/api/partners/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, consent }) })
      .then((r) => r.json())
      .catch(() => null);
    setBusy(false);
    if (d?.ok) setDone(true);
    else setError(ERRORS[d?.error] ?? "Something went wrong. Please try again.");
  };

  if (done) {
    return (
      <div className="w-full max-w-lg rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-xl shadow-gray-200/60">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
        <h1 className="mt-4 font-display text-2xl font-bold text-ink-950">Thanks — application received</h1>
        <p className="mt-2 text-sm text-gray-600">
          We&apos;ll check your licences and contact you. Once approved you&apos;ll get an email to set your password, and
          companies on {platformName} will be able to find you.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="my-6 w-full max-w-2xl space-y-5 rounded-3xl border border-gray-100 bg-white p-6 shadow-xl shadow-gray-200/60">
      <div>
        <p className="text-sm font-semibold text-brand-600">{platformName}</p>
        <h1 className="font-display text-2xl font-bold text-ink-950">Join the partner network</h1>
        <p className="mt-1 text-sm text-gray-600">
          Licensed drivers and operators: let taxi companies on our platform find you when they need someone to cover a job.
          {price > 0 ? ` £${price} a month once approved — we send you a payment link.` : ""} Only signed-in, licensed companies
          can see your profile; your number is shared only when a company asks to contact you.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {([["driver", "Licensed driver"], ["operator", "Driver with my own operator licence"]] as const).map(([k, label]) => (
          <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${f.kind === k ? "border-brand-500 bg-brand-50 font-semibold" : "border-gray-200"}`}>
            <input type="radio" name="kind" checked={f.kind === k} onChange={() => setF({ ...f, kind: k })} className="accent-brand-600" /> {label}
          </label>
        ))}
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold text-ink-950">You</legend>
        <label className="text-sm">Full name<input value={f.full_name} onChange={set("full_name")} className={field} autoComplete="name" /></label>
        <label className="text-sm">Email<input type="email" value={f.email} onChange={set("email")} className={field} autoComplete="email" /></label>
        <label className="text-sm">Mobile / WhatsApp<input type="tel" value={f.phone} onChange={set("phone")} className={field} placeholder="+44 7…" autoComplete="tel" /></label>
        <label className="text-sm">Areas you cover<input value={f.areas} onChange={set("areas")} className={field} placeholder="e.g. Heathrow, West London, Slough" /></label>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-semibold text-ink-950">Driver licence (badge)</legend>
        <label className="text-sm sm:col-span-3">Licensing council
          <input list="councils" value={f.council} onChange={set("council")} className={field} placeholder="e.g. Transport for London" />
        </label>
        <label className="text-sm sm:col-span-2">Badge / licence number<input value={f.badge_number} onChange={set("badge_number")} className={field} /></label>
        <label className="text-sm">Expires<input type="date" value={f.badge_expires} onChange={set("badge_expires")} className={field} /></label>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-semibold text-ink-950">Vehicle</legend>
        <label className="text-sm">Type
          <select value={f.vehicle_type} onChange={set("vehicle_type")} className={field}>
            {["Saloon", "Estate", "Executive", "MPV", "8 Seater", "Wheelchair accessible"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-sm">Make<input value={f.vehicle_make} onChange={set("vehicle_make")} className={field} placeholder="Toyota" /></label>
        <label className="text-sm">Model<input value={f.vehicle_model} onChange={set("vehicle_model")} className={field} placeholder="Prius" /></label>
        <label className="text-sm">Colour<input value={f.vehicle_colour} onChange={set("vehicle_colour")} className={field} /></label>
        <label className="text-sm">Passenger seats<input inputMode="numeric" value={f.vehicle_seats} onChange={set("vehicle_seats")} className={field} /></label>
        <label className="text-sm">Registration<input value={f.plate_number} onChange={set("plate_number")} className={field} /></label>
        <label className="text-sm sm:col-span-2">Vehicle licence (plate) number<input value={f.vehicle_licence_number} onChange={set("vehicle_licence_number")} className={field} /></label>
        <label className="text-sm">Expires<input type="date" value={f.vehicle_licence_expires} onChange={set("vehicle_licence_expires")} className={field} /></label>
      </fieldset>

      {f.kind === "operator" && (
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-1 text-sm font-semibold text-ink-950">Operator licence</legend>
          <label className="text-sm sm:col-span-3">Issuing council<input list="councils" value={f.operator_council} onChange={set("operator_council")} className={field} /></label>
          <label className="text-sm sm:col-span-2">Operator licence number<input value={f.operator_licence_number} onChange={set("operator_licence_number")} className={field} /></label>
          <label className="text-sm">Expires<input type="date" value={f.operator_licence_expires} onChange={set("operator_licence_expires")} className={field} /></label>
        </fieldset>
      )}

      <label className="block text-sm">Anything else (languages, airports, child seats…)
        <textarea value={f.about} onChange={set("about")} rows={2} className={field} />
      </label>

      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
        <span>
          I agree that my profile (name, licences, vehicle, areas, availability) is shown to licensed companies on {platformName},
          and my phone number is given to a company when it asks to contact me. My licence details are true and current.
        </span>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Send application
      </button>
      <datalist id="councils">{councils.map((c) => <option key={c} value={c} />)}</datalist>
    </form>
  );
}
