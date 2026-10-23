"use client";

import { useState } from "react";
import {
  Radio, Smartphone, CarFront, Palette, Bell, MapPin, Clock, User, CheckCircle2, ChevronRight,
  Navigation, Phone, Banknote, CreditCard, RotateCcw,
} from "lucide-react";

/**
 * Interactive product demo on the home page. Everything here is sample data
 * running in the visitor's browser — nothing is saved and no real company's
 * data is ever shown.
 */

type Tab = "dispatch" | "booking" | "driver" | "brand";
const TABS: { id: Tab; label: string; icon: typeof Radio }[] = [
  { id: "dispatch", label: "Dispatch board", icon: Radio },
  { id: "booking", label: "Customer booking", icon: Smartphone },
  { id: "driver", label: "Driver app", icon: CarFront },
  { id: "brand", label: "Your brand", icon: Palette },
];

export default function ProductTour() {
  const [tab, setTab] = useState<Tab>("dispatch");
  return (
    <div>
      <div className="mx-auto mb-6 flex max-w-2xl flex-wrap justify-center gap-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
              tab === id ? "bg-ink-950 text-white shadow" : "bg-white text-gray-600 shadow-sm hover:text-ink-950"
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
      {tab === "dispatch" && <DispatchDemo />}
      {tab === "booking" && <BookingDemo />}
      {tab === "driver" && <DriverDemo />}
      {tab === "brand" && <BrandDemo />}
      <p className="mt-4 text-center text-xs text-gray-400">Interactive demo with sample data — try the buttons.</p>
    </div>
  );
}

/* ── frames ─────────────────────────────────────────────────────────────── */

function BrowserFrame({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-gray-300/40">
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2.5">
        <span className="h-3 w-3 rounded-full bg-red-300" />
        <span className="h-3 w-3 rounded-full bg-amber-300" />
        <span className="h-3 w-3 rounded-full bg-emerald-300" />
        <span className="ml-3 flex-1 truncate rounded-lg bg-white px-3 py-1 text-xs text-gray-400">{url}</span>
      </div>
      {children}
    </div>
  );
}

function PhoneFrame({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <div className="mx-auto w-[300px] rounded-[2.5rem] border-[10px] border-ink-950 bg-ink-950 shadow-2xl shadow-gray-400/40">
      <div className={`h-[560px] overflow-hidden rounded-[1.8rem] ${dark ? "bg-gray-100" : "bg-white"}`}>{children}</div>
    </div>
  );
}

/* ── dispatch board ─────────────────────────────────────────────────────── */

type Status = "pending" | "assigned" | "accepted" | "arrived" | "on trip" | "completed";
const FLOW: Status[] = ["pending", "assigned", "accepted", "arrived", "on trip", "completed"];
const TONE: Record<Status, string> = {
  pending: "bg-amber-50 text-amber-700",
  assigned: "bg-sky-50 text-sky-700",
  accepted: "bg-indigo-50 text-indigo-700",
  arrived: "bg-violet-50 text-violet-700",
  "on trip": "bg-brand-50 text-brand-700",
  completed: "bg-emerald-50 text-emerald-700",
};
interface Job {
  ref: string;
  time: string;
  from: string;
  to: string;
  customer: string;
  car: string;
  fare: number;
  paid: "Card" | "Cash";
  driver: string | null;
  status: Status;
}
const START_JOBS: Job[] = [
  { ref: "TX-1042", time: "Now", from: "Heathrow Terminal 5", to: "Reading RG1", customer: "Sarah M.", car: "Saloon", fare: 68, paid: "Card", driver: null, status: "pending" },
  { ref: "TX-1043", time: "14:30", from: "Maidenhead Station", to: "Gatwick South", customer: "Daniel K.", car: "Estate", fare: 112, paid: "Card", driver: "Imran", status: "accepted" },
  { ref: "TX-1044", time: "15:10", from: "Windsor Castle", to: "Slough High St", customer: "Priya S.", car: "Saloon", fare: 24, paid: "Cash", driver: null, status: "pending" },
  { ref: "TX-1045", time: "17:45", from: "Bracknell", to: "Stansted Airport", customer: "Tom W.", car: "MPV", fare: 165, paid: "Card", driver: "Ali", status: "assigned" },
];
const DRIVERS = ["Imran", "Ali", "James", "Marek"];

function DispatchDemo() {
  const [jobs, setJobs] = useState<Job[]>(START_JOBS);
  const [picking, setPicking] = useState<string | null>(null);
  const [bell, setBell] = useState<string[]>(["New booking TX-1044 · Priya S.", "TX-1043 accepted by Imran"]);
  const [bellOpen, setBellOpen] = useState(false);

  const notify = (t: string) => setBell((b) => [t, ...b].slice(0, 6));
  const assign = (ref: string, driver: string) => {
    setJobs((js) => js.map((j) => (j.ref === ref ? { ...j, driver, status: "assigned" } : j)));
    setPicking(null);
    notify(`${ref} assigned to ${driver} — push sent to their phone`);
  };
  const advance = (ref: string) => {
    setJobs((js) =>
      js.map((j) => {
        if (j.ref !== ref) return j;
        const next = FLOW[Math.min(FLOW.indexOf(j.status) + 1, FLOW.length - 1)];
        const msg: Partial<Record<Status, string>> = {
          accepted: `${ref} accepted by ${j.driver}`,
          arrived: `${ref}: driver arrived — customer texted`,
          "on trip": `${ref}: passenger picked up`,
          completed: `${ref} completed · thank-you email sent`,
        };
        if (msg[next]) notify(msg[next]!);
        return { ...j, status: next };
      })
    );
  };
  const busy = new Set(jobs.filter((j) => ["accepted", "arrived", "on trip"].includes(j.status)).map((j) => j.driver));
  const takings = jobs.filter((j) => j.status === "completed").reduce((n, j) => n + j.fare, 0);

  return (
    <BrowserFrame url="yourcompany · dispatch board">
      <div className="grid gap-0 md:grid-cols-[1fr_220px]">
        <div className="p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="font-display text-lg font-bold text-ink-950">Live jobs</p>
              <p className="text-xs text-gray-500">{jobs.filter((j) => j.status !== "completed").length} open · £{takings} completed today</p>
            </div>
            <div className="relative">
              <button onClick={() => setBellOpen((o) => !o)} className="relative rounded-xl border border-gray-200 p-2" aria-label="Notifications">
                <Bell className="h-5 w-5 text-ink-950" />
                <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">{bell.length}</span>
              </button>
              {bellOpen && (
                <div className="absolute right-0 z-10 mt-2 w-72 rounded-xl border border-gray-100 bg-white p-2 shadow-xl">
                  {bell.map((b, i) => (
                    <p key={i} className="rounded-lg px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50">{b}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2.5">
            {jobs.map((j) => (
              <div key={j.ref} className="rounded-xl border border-gray-100 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-gray-400">{j.ref}</span>
                    <span className="flex items-center gap-1 font-semibold text-ink-950"><Clock className="h-3.5 w-3.5" /> {j.time}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${TONE[j.status]}`}>{j.status}</span>
                  </div>
                  <span className="text-sm font-bold text-ink-950">£{j.fare} <span className="text-xs font-normal text-gray-400">· {j.paid}</span></span>
                </div>
                <p className="mt-1.5 flex items-center gap-1 text-sm text-gray-700">
                  <MapPin className="h-3.5 w-3.5 text-emerald-500" /> {j.from} <ChevronRight className="h-3.5 w-3.5 text-gray-300" /> {j.to}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-gray-500">
                    <User className="mr-1 inline h-3 w-3" />{j.customer} · {j.car}{j.driver ? ` · Driver ${j.driver}` : ""}
                  </p>
                  {j.status === "pending" ? (
                    picking === j.ref ? (
                      <div className="flex flex-wrap gap-1">
                        {DRIVERS.map((d) => (
                          <button key={d} onClick={() => assign(j.ref, d)} disabled={busy.has(d)}
                            className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-ink-950 hover:border-brand-500 disabled:opacity-40">
                            {d}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <button onClick={() => setPicking(j.ref)} className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-semibold text-white">Assign driver</button>
                    )
                  ) : j.status !== "completed" ? (
                    <button onClick={() => advance(j.ref)} className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-700">
                      Simulate driver: next step →
                    </button>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Done</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => { setJobs(START_JOBS); setBell([]); }} className="mt-3 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
            <RotateCcw className="h-3 w-3" /> Reset demo
          </button>
        </div>
        <div className="border-t border-gray-100 bg-gray-50 p-4 md:border-l md:border-t-0">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Drivers</p>
          {DRIVERS.map((d) => (
            <div key={d} className="mb-2 flex items-center justify-between rounded-xl bg-white px-3 py-2 text-sm shadow-sm">
              <span className="font-medium text-ink-950">{d}</span>
              <span className={`flex items-center gap-1 text-xs font-semibold ${busy.has(d) ? "text-amber-600" : "text-emerald-600"}`}>
                <span className={`h-2 w-2 rounded-full ${busy.has(d) ? "bg-amber-500" : "bg-emerald-500"}`} /> {busy.has(d) ? "Busy" : "Online"}
              </span>
            </div>
          ))}
          <div className="mt-4 overflow-hidden rounded-xl bg-white p-3 shadow-sm">
            <p className="text-xs font-semibold text-gray-500">Live map</p>
            <div className="relative mt-2 h-28 rounded-lg bg-[linear-gradient(90deg,#eef2f7_1px,transparent_1px),linear-gradient(#eef2f7_1px,transparent_1px)] bg-[size:16px_16px]">
              {DRIVERS.map((d, i) => (
                <span key={d} className={`absolute flex h-6 items-center rounded-full px-2 text-[10px] font-bold text-white shadow ${busy.has(d) ? "bg-amber-500" : "bg-brand-600"}`}
                  style={{ left: `${10 + i * 21}%`, top: `${15 + ((i * 37) % 60)}%` }}>
                  {d}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ── customer booking ───────────────────────────────────────────────────── */

const CARS = [
  { name: "Saloon", seats: 4, bags: 2, price: 68 },
  { name: "Estate", seats: 4, bags: 4, price: 79 },
  { name: "Executive", seats: 4, bags: 3, price: 96 },
];

function BookingDemo({ color }: { color?: string }) {
  const [step, setStep] = useState(0);
  const [car, setCar] = useState(0);
  const [pay, setPay] = useState<"card" | "cash">("card");
  const accent = color ? { background: color } : undefined;
  const accentText = color ? { color } : undefined;
  return (
    <PhoneFrame>
      <div className="flex h-full flex-col">
        <div className="px-5 pb-3 pt-6 text-center">
          <p className="font-display text-lg font-bold text-ink-950">Your Company</p>
          <p className="text-xs text-gray-400">Book your ride</p>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 pb-5">
          {step === 0 && (
            <>
              <div className="space-y-2 rounded-2xl border border-gray-100 p-3 text-sm">
                <p className="flex items-center gap-2 text-gray-700"><MapPin className="h-4 w-4 text-emerald-500" /> Heathrow Terminal 5</p>
                <p className="flex items-center gap-2 text-gray-700"><MapPin className="h-4 w-4 text-red-500" /> Reading RG1 1AA</p>
                <p className="flex items-center gap-2 text-gray-500"><Clock className="h-4 w-4" /> Tomorrow, 08:30</p>
              </div>
              <button onClick={() => setStep(1)} className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white" style={accent}>See prices</button>
            </>
          )}
          {step === 1 && (
            <>
              <p className="text-xs text-gray-500">32 miles · about 45 min</p>
              {CARS.map((c, i) => (
                <button key={c.name} onClick={() => setCar(i)}
                  className={`flex w-full items-center justify-between rounded-2xl border p-3 text-left ${car === i ? "border-2 border-brand-500" : "border-gray-100"}`}
                  style={car === i && color ? { borderColor: color } : undefined}>
                  <span>
                    <span className="block text-sm font-semibold text-ink-950">{c.name}</span>
                    <span className="text-xs text-gray-400">{c.seats} seats · {c.bags} cases</span>
                  </span>
                  <span className="font-display text-lg font-bold text-ink-950">£{c.price}</span>
                </button>
              ))}
              <button onClick={() => setStep(2)} className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white" style={accent}>Continue</button>
            </>
          )}
          {step === 2 && (
            <>
              <div className="space-y-2 text-sm">
                <p className="rounded-xl border border-gray-100 px-3 py-2 text-gray-700">Sarah Mitchell</p>
                <p className="rounded-xl border border-gray-100 px-3 py-2 text-gray-700">07700 900123</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["card", "cash"] as const).map((p) => (
                  <button key={p} onClick={() => setPay(p)}
                    className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-semibold ${pay === p ? "border-brand-500 bg-brand-50 text-brand-700" : "border-gray-100 text-gray-500"}`}>
                    {p === "card" ? <CreditCard className="h-4 w-4" /> : <Banknote className="h-4 w-4" />} {p === "card" ? "Card" : "Cash"}
                  </button>
                ))}
              </div>
              <button onClick={() => setStep(3)} className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white" style={accent}>
                {pay === "card" ? `Pay £${CARS[car].price}` : `Book · £${CARS[car].price}`}
              </button>
            </>
          )}
          {step === 3 && (
            <div className="pt-6 text-center">
              <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
              <p className="mt-3 font-display text-lg font-bold text-ink-950">Booking confirmed</p>
              <p className="font-mono text-xs text-gray-400">TX-1046</p>
              <p className="mt-3 text-sm text-gray-600">Confirmation sent by SMS and email. Track your driver live on your phone.</p>
              <button onClick={() => setStep(0)} className="mt-5 text-sm font-semibold text-brand-600" style={accentText}>Book another ride</button>
            </div>
          )}
        </div>
      </div>
    </PhoneFrame>
  );
}

/* ── driver app ─────────────────────────────────────────────────────────── */

const DRIVER_STEPS = ["New job", "Accepted", "On my way", "Arrived", "Picked up", "Completed"];

function DriverDemo() {
  const [step, setStep] = useState(0);
  const next = ["Accept job", "On my way", "I've arrived", "Passenger picked up", "Complete ride"][step];
  return (
    <PhoneFrame dark>
      <div className="flex h-full flex-col">
        <div className="bg-ink-950 px-4 pb-4 pt-6 text-white">
          <p className="font-display text-base font-bold">Imran Hussain</p>
          <p className="text-xs text-gray-400">Silver Toyota Prius · AB12 CDE</p>
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Online
          </span>
        </div>
        <div className="flex-1 space-y-3 p-4">
          {step === 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">
              <Bell className="h-4 w-4" /> New job · tomorrow 08:30
            </div>
          )}
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-gray-400">TX-1042</span>
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">{DRIVER_STEPS[step]}</span>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-700"><MapPin className="h-4 w-4 text-emerald-500" /> Heathrow Terminal 5</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-700"><MapPin className="h-4 w-4 text-red-500" /> Reading RG1</p>
            <p className="mt-2 text-xs text-gray-500">Sarah M. · Saloon · £68 paid by card</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <span className="flex items-center justify-center gap-1 rounded-xl border border-gray-100 py-2 text-xs font-semibold text-gray-600"><Navigation className="h-3.5 w-3.5" /> Navigate</span>
              <span className="flex items-center justify-center gap-1 rounded-xl border border-gray-100 py-2 text-xs font-semibold text-gray-600"><Phone className="h-3.5 w-3.5" /> Call</span>
            </div>
          </div>
          {step < 5 ? (
            <button onClick={() => setStep((s) => s + 1)} className="w-full rounded-2xl bg-brand-600 py-4 text-base font-bold text-white shadow-lg">
              {next}
            </button>
          ) : (
            <div className="rounded-2xl bg-emerald-50 p-4 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
              <p className="mt-1 text-sm font-semibold text-emerald-800">Ride complete — the office sees it instantly</p>
              <button onClick={() => setStep(0)} className="mt-2 text-xs font-semibold text-emerald-700">Start again</button>
            </div>
          )}
          <p className="text-center text-[11px] text-gray-400">Each step updates the dispatch board and texts the customer.</p>
        </div>
      </div>
    </PhoneFrame>
  );
}

/* ── white label ────────────────────────────────────────────────────────── */

const SWATCHES = ["#1d4ed8", "#b07d12", "#059669", "#dc2626", "#7c3aed", "#0f172a"];

function BrandDemo() {
  const [color, setColor] = useState(SWATCHES[1]);
  return (
    <div className="mx-auto grid max-w-4xl items-center gap-8 md:grid-cols-2">
      <div>
        <h3 className="font-display text-2xl font-bold text-ink-950">Your name, your colours</h3>
        <p className="mt-2 text-gray-600">
          Upload your logo and pick your colours in Settings. Your booking page, apps, emails and receipts all change at once —
          customers only ever see your brand.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          {SWATCHES.map((c) => (
            <button key={c} onClick={() => setColor(c)} aria-label={`Colour ${c}`}
              className={`h-10 w-10 rounded-full shadow ${color === c ? "ring-4 ring-gray-300 ring-offset-2" : ""}`} style={{ background: c }} />
          ))}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-10 cursor-pointer rounded-full" aria-label="Any colour" />
        </div>
        <ul className="mt-5 space-y-2 text-sm text-gray-700">
          {["Booking widget for your own website", "Installable apps for customers, office and drivers", "Your own Stripe, SMS and email accounts"].map((t) => (
            <li key={t} className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> {t}</li>
          ))}
        </ul>
      </div>
      <BookingDemo color={color} />
    </div>
  );
}
