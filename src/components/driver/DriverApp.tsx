"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  Check,
  CircleDot,
  Loader2,
  LogOut,
  MapPin,
  Navigation,
  Phone,
  Power,
  Users,
  Baby,
  Banknote,
  CreditCard,
  StickyNote,
  X,
  Car,
  Flag,
  History,
  Wallet,
  ListChecks,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import JobMap from "@/components/driver/JobMap";
import { createClient } from "@/lib/supabase/client";
import { LogoMark } from "@/components/Brand";
import { money, cn } from "@/lib/format";

/* ── Types ────────────────────────────────────────────────────────────────── */

type Availability = "offline" | "online" | "on_trip";

interface Me {
  id: string;
  full_name: string;
  availability: Availability;
  is_blocked: boolean;
  is_approved: boolean;
  vehicle: { make: string | null; model: string | null; color: string | null; plate: string | null } | null;
}

interface Job {
  id: string;
  booking_number: string;
  status: "assigned" | "accepted" | "driver_arrived" | "in_progress";
  customer_name: string;
  customer_whatsapp: string | null;
  pickup_address: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_address: string;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  via_points: { address: string; lat: number | null; lng: number | null }[] | null;
  scheduled_at: string | null;
  passengers: number;
  suitcases: number;
  hand_luggage: number;
  child_seat: boolean;
  notes: string | null;
  payment_method: "cash" | "card";
  payment_status: string;
  estimated_fare: number | null;
  final_fare: number | null;
  category: { name: string } | null;
}

const ACTIVE = ["accepted", "driver_arrived", "in_progress"] as const;
/** Pre-booked jobs move from Scheduled to Jobs this long before pickup. */
const LIVE_WINDOW_MS = 60 * 60_000;
const JOB_FIELDS =
  "id, booking_number, status, customer_name, customer_whatsapp, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, via_points, scheduled_at, passengers, suitcases, hand_luggage, child_seat, notes, payment_method, payment_status, estimated_fare, final_fare, category:vehicle_categories!bookings_vehicle_category_id_fkey(name)";

/**
 * Location is sent at most every 30 s, and only when the driver has moved
 * 40 m or more — plus a heartbeat every 3 minutes so a parked driver still
 * shows as "seen recently". Light on the database, fine for a dispatch map.
 */
const LOCATION_MIN_MS = 30_000;
const LOCATION_MIN_M = 40;
const LOCATION_HEARTBEAT_MS = 180_000;

const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const whenLabel = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        timeZone: "Europe/London",
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "As soon as possible";

/** Google Maps turn-by-turn to a point (opens the Maps app on phones). */
const navUrl = (lat: number | null, lng: number | null, address: string) =>
  `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${
    lat != null && lng != null ? `${lat},${lng}` : encodeURIComponent(address)
  }`;

const urlB64ToUint8 = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25, 0.5].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = "sine";
      o.frequency.value = i === 2 ? 1175 : 880;
      g.gain.setValueAtTime(0.001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.22);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.25);
    });
    navigator.vibrate?.([300, 150, 300]);
  } catch {
    /* no sound available */
  }
}

/* ── App ──────────────────────────────────────────────────────────────────── */

export default function DriverApp() {
  const [supabase] = useState(() => createClient());
  const [me, setMe] = useState<Me | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [notLinked, setNotLinked] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState<Job | null>(null);
  const [geo, setGeo] = useState<"idle" | "on" | "denied" | "unsupported">("idle");
  const [push, setPush] = useState<"unknown" | "on" | "off" | "denied" | "unsupported" | "install">("unknown");
  const knownAssigned = useRef<Set<string> | null>(null);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [tab, setTab] = useState<"jobs" | "scheduled" | "history" | "cash">("jobs");
  // "Now", ticking, so a pre-booked job moves to Jobs an hour before pickup by itself.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  // A tapped notification opens /driver?job=<id> — bring that job to the top.
  const [focusJob, setFocusJob] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("job");
    if (id) setFocusJob(id);
  }, []);

  /* Data */
  const loadMe = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("driver_me");
    if (err || !data) {
      setNotLinked(true);
      return null;
    }
    setMe(data as Me);
    return data as Me;
  }, [supabase]);

  // A tapped notification for a job that is still a pre-booking opens Scheduled.
  const focusHandled = useRef(false);
  useEffect(() => {
    if (focusHandled.current || !focusJob || !nowMs) return;
    const j = jobs.find((x) => x.id === focusJob);
    if (!j) return;
    focusHandled.current = true;
    const pre =
      !!j.scheduled_at &&
      !["driver_arrived", "in_progress"].includes(j.status) &&
      new Date(j.scheduled_at).getTime() - nowMs > LIVE_WINDOW_MS;
    if (pre) setTab("scheduled");
  }, [jobs, focusJob, nowMs]);

  const loadJobs = useCallback(async () => {
    const { data } = await supabase
      .from("bookings")
      .select(JOB_FIELDS)
      .in("status", ["assigned", ...ACTIVE])
      .order("scheduled_at", { ascending: true, nullsFirst: true });
    const list = (data as unknown as Job[]) ?? [];
    // Chime for a job that wasn't here a moment ago (not on first load).
    const assigned = new Set(list.filter((j) => j.status === "assigned").map((j) => j.id));
    if (knownAssigned.current && [...assigned].some((id) => !knownAssigned.current!.has(id))) chime();
    knownAssigned.current = assigned;
    setJobs(list);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const m = await loadMe();
      if (m) await loadJobs();
      setLoading(false);
    })();
  }, [loadMe, loadJobs]);

  /* Live updates: own jobs and own record; a slow poll as a safety net. */
  useEffect(() => {
    if (!me?.id) return;
    const ch = supabase
      .channel(`driver-${me.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `driver_id=eq.${me.id}` }, () => loadJobs())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "drivers", filter: `id=eq.${me.id}` }, () => loadMe())
      .subscribe();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") loadJobs();
    }, 30_000);
    const onVisible = () => document.visibilityState === "visible" && (loadJobs(), loadMe());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [supabase, me?.id, loadJobs, loadMe]);

  const online = !!me && me.availability !== "offline";

  /* Live location while online. Phones pause it when the app is closed. */
  useEffect(() => {
    if (!online) return;
    if (!("geolocation" in navigator)) {
      setGeo("unsupported");
      return;
    }
    let lastSent = 0;
    let lastPt: { lat: number; lng: number } | null = null;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setGeo("on");
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPosition(here);
        const now = Date.now();
        const since = now - lastSent;
        const moved = lastPt ? metres(lastPt, here) : Infinity;
        if (since < LOCATION_MIN_MS) return;
        if (moved < LOCATION_MIN_M && since < LOCATION_HEARTBEAT_MS) return;
        lastSent = now;
        lastPt = here;
        // supabase-js only sends a request once it is awaited/then'd — a bare
        // call is never executed. Retry on the next fix if this one fails.
        supabase
          .rpc("driver_update_location", {
            p_lat: here.lat,
            p_lng: here.lng,
            p_heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
            p_speed_kmh: Number.isFinite(pos.coords.speed) && pos.coords.speed != null ? pos.coords.speed * 3.6 : null,
          })
          .then(({ error: locErr }) => {
            if (locErr) {
              console.error("[driver] location update failed", locErr.message);
              lastSent = 0;
            }
          });
      },
      (err) => setGeo(err.code === err.PERMISSION_DENIED ? "denied" : "idle"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 }
    );
    // Keep the screen awake while online so the location keeps flowing.
    let lock: { release: () => Promise<void> } | null = null;
    const wake = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        if (document.visibilityState === "visible") lock = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        lock = null;
      }
    };
    wake();
    document.addEventListener("visibilitychange", wake);
    return () => {
      navigator.geolocation.clearWatch(id);
      document.removeEventListener("visibilitychange", wake);
      lock?.release().catch(() => {});
    };
  }, [online, supabase]);

  /* Job alerts (push). Re-register quietly if already allowed. */
  const registerPush = useCallback(async (ask: boolean) => {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window) || !key) {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches;
      setPush(ios && !standalone ? "install" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") return setPush("denied");
    if (Notification.permission !== "granted") {
      if (!ask) return setPush("off");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setPush(perm === "denied" ? "denied" : "off");
    }
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(key) }));
      const res = await fetch("/api/driver/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      setPush(res.ok ? "on" : "off");
    } catch {
      setPush("off");
    }
  }, []);

  useEffect(() => {
    if (me?.id) registerPush(false);
  }, [me?.id, registerPush]);

  /* Actions */
  const setOnline = async (next: boolean) => {
    setToggling(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("driver_set_online", { p_online: next });
    setToggling(false);
    const res = data as { ok: boolean; error?: string; availability?: Availability } | null;
    if (err || !res?.ok) {
      setError(res?.error === "blocked" ? "Your account is paused. Contact the office." : "Could not change your status. Try again.");
      return;
    }
    setMe((m) => (m ? { ...m, availability: res.availability ?? (next ? "online" : "offline") } : m));
  };

  const act = async (job: Job, action: "accept" | "decline" | "arrived" | "start" | "complete", cash = true) => {
    if (action === "decline" && !confirm("Decline this job? It goes back to the office to give to someone else.")) return;
    setBusyJob(job.id);
    setError(null);
    const { data, error: err } = await supabase.rpc("driver_job_action", {
      p_booking_id: job.id,
      p_action: action,
      p_cash_received: cash,
    });
    setBusyJob(null);
    const res = data as { ok: boolean; error?: string } | null;
    if (err || !res?.ok) {
      setError(
        res?.error === "not_allowed_now"
          ? "That step isn't available any more — the job was updated. Refreshing."
          : res?.error === "not_your_job"
            ? "This job is no longer yours — the office changed it."
            : "Could not update the job. Check your signal and try again."
      );
    }
    await Promise.all([loadJobs(), loadMe()]);
  };

  const signOut = async () => {
    if (online && !confirm("Signing out also takes you offline. Continue?")) return;
    await supabase.rpc("driver_set_online", { p_online: false });
    await supabase.auth.signOut();
    window.location.href = "/driver/login";
  };

  /* ── Render ── */

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-ink-950">
        <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
      </main>
    );
  }

  if (notLinked || !me) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink-950 p-6 text-center text-white">
        <LogoMark size={56} />
        <p className="font-display text-lg font-bold">This login isn&apos;t linked to a driver yet</p>
        <p className="max-w-xs text-sm text-gray-400">Ask the office to connect your account in Admin → Drivers.</p>
        <button onClick={signOut} className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold">
          Sign out
        </button>
      </main>
    );
  }

  // Live = being driven, or due within the hour (or "as soon as possible").
  // Everything else is a pre-booking and lives in the Scheduled tab.
  const isLive = (j: Job) =>
    j.status === "driver_arrived" ||
    j.status === "in_progress" ||
    !j.scheduled_at ||
    new Date(j.scheduled_at).getTime() - nowMs <= LIVE_WINDOW_MS;
  const liveJobs = jobs.filter(isLive);
  const scheduled = jobs
    .filter((j) => !isLive(j))
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  const active = liveJobs.find((j) => (ACTIVE as readonly string[]).includes(j.status)) ?? null;
  const offers = liveJobs
    .filter((j) => j.status === "assigned")
    .sort((a, b) => (a.id === focusJob ? -1 : b.id === focusJob ? 1 : 0));
  const scheduledToAccept = scheduled.filter((j) => j.status === "assigned").length;
  const car = me.vehicle ? [me.vehicle.color, me.vehicle.make, me.vehicle.model].filter(Boolean).join(" ") : "";

  return (
    <main className="min-h-dvh bg-gray-100 pb-[calc(24px+env(safe-area-inset-bottom))]">
      {/* Header */}
      <header className="bg-ink-950 px-4 pb-5 pt-[calc(14px+env(safe-area-inset-top))] text-white">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <div className="rounded-xl bg-white p-1">
            <LogoMark size={30} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-bold">{me.full_name}</p>
            <p className="truncate text-xs text-gray-400">
              {car || "Signature Driver"}
              {me.vehicle?.plate ? ` · ${me.vehicle.plate}` : ""}
            </p>
          </div>
          <button onClick={signOut} className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>

        {/* Online switch */}
        <div className="mx-auto mt-4 max-w-lg">
          <button
            onClick={() => setOnline(!online)}
            disabled={toggling || me.availability === "on_trip"}
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors",
              me.availability === "on_trip" ? "bg-brand-500" : online ? "bg-green-600" : "bg-white/10"
            )}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
              {toggling ? <Loader2 className="h-5 w-5 animate-spin" /> : <Power className="h-5 w-5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-base font-bold">
                {me.availability === "on_trip" ? "Busy — on a job" : online ? "You're online" : "You're offline"}
              </span>
              <span className="block text-xs text-white/80">
                {me.availability === "on_trip"
                  ? "You'll be available again when this job is completed"
                  : online
                    ? "The office can see you and send you jobs · tap to go offline"
                    : "Tap to go online and start receiving jobs"}
              </span>
            </span>
          </button>
        </div>
      </header>

      <nav className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto grid max-w-lg grid-cols-4">
          {(
            [
              ["jobs", "Jobs", ListChecks],
              ["scheduled", "Scheduled", CalendarClock],
              ["history", "History", History],
              ["cash", "Cash", Wallet],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center justify-center gap-1 border-b-2 py-3 text-xs font-semibold sm:gap-1.5 sm:text-sm",
                tab === key ? "border-brand-500 text-ink-950" : "border-transparent text-gray-400"
              )}
            >
              <Icon className="h-4 w-4" /> {label}
              {key === "jobs" && offers.length > 0 && (
                <span className="rounded-full bg-brand-500 px-1.5 text-[10px] font-bold text-white">{offers.length}</span>
              )}
              {key === "scheduled" && scheduled.length > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] font-bold",
                    scheduledToAccept > 0 ? "bg-brand-500 text-white" : "bg-gray-200 text-gray-600"
                  )}
                >
                  {scheduled.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {tab === "scheduled" && (
        <div className="mx-auto max-w-lg space-y-3 px-4 pt-4">
          <p className="px-1 text-sm text-gray-500">
            Pre-booked jobs. Accept them now — each one moves to <b>Jobs</b> an hour before pickup, and you&apos;ll get a reminder.
          </p>
          {scheduled.length === 0 && (
            <div className="rounded-2xl bg-white px-5 py-10 text-center shadow-sm">
              <CalendarClock className="mx-auto mb-3 h-8 w-8 text-gray-300" />
              <p className="font-display text-base font-bold text-ink-950">No pre-booked jobs</p>
            </div>
          )}
          {scheduled.map((job) => (
            <JobCard key={job.id} job={job} highlight={job.id === focusJob}>
              <div className="mt-3">
                <LinkBtn icon={Navigation} href={navUrl(job.pickup_lat, job.pickup_lng, job.pickup_address)} label="See pick-up on the map" />
              </div>
              {job.status === "assigned" ? (
                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                  <BigBtn icon={Check} label="Accept booking" busy={busyJob === job.id} onClick={() => act(job, "accept")} />
                  <button
                    onClick={() => act(job, "decline")}
                    disabled={busyJob === job.id}
                    className="rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-600"
                  >
                    Decline
                  </button>
                </div>
              ) : (
                <div className="mt-3 rounded-xl bg-green-50 px-3 py-2.5 text-sm text-green-800">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <Check className="h-4 w-4" /> Accepted
                  </p>
                  <p className="text-xs text-green-700">It moves to Jobs an hour before pickup.</p>
                  <button
                    onClick={() => act(job, "decline")}
                    disabled={busyJob === job.id}
                    className="mt-1.5 text-xs font-semibold text-gray-500 underline"
                  >
                    Can&apos;t do this job any more
                  </button>
                </div>
              )}
            </JobCard>
          ))}
        </div>
      )}
      {tab === "history" && <HistoryTab supabase={supabase} />}
      {tab === "cash" && <CashTab supabase={supabase} />}

      <div className={cn("mx-auto max-w-lg space-y-3 px-4 pt-4", tab !== "jobs" && "hidden")}>
        {error && (
          <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-700">
            <X className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {/* Alerts + location health */}
        {push !== "on" && push !== "unknown" && (
          <Notice
            icon={push === "denied" ? BellOff : Bell}
            tone="amber"
            text={
              push === "install"
                ? "To get new-job alerts on iPhone, add this app to your Home Screen first."
                : push === "denied"
                  ? "Job alerts are blocked. Allow notifications for this app in your phone's settings."
                  : push === "unsupported"
                    ? "This browser can't show job alerts. Keep the app open while you work."
                    : "Turn on alerts so you hear about new jobs even when the app is closed."
            }
            action={
              push === "off"
                ? { label: "Turn on alerts", onClick: () => registerPush(true) }
                : push === "install"
                  ? { label: "How to install", onClick: () => (window.location.href = "/install/driver") }
                  : undefined
            }
          />
        )}
        {online && geo === "denied" && (
          <Notice
            icon={MapPin}
            tone="red"
            text="Location is blocked, so the office can't see you on the map. Allow location for this app in your phone's settings."
          />
        )}

        {/* Current job */}
        {active && (
          <JobCard job={active} highlight>
            <ActiveSteps status={active.status} />
            <div className="mt-3">
              <ActiveJobMap job={active} me={position} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {active.status === "in_progress" ? (
                <LinkBtn icon={Navigation} href={navUrl(active.dropoff_lat, active.dropoff_lng, active.dropoff_address)} label="Navigate to drop-off" />
              ) : (
                <LinkBtn icon={Navigation} href={navUrl(active.pickup_lat, active.pickup_lng, active.pickup_address)} label="Navigate to pick-up" />
              )}
              {active.customer_whatsapp ? (
                <LinkBtn icon={Phone} href={`tel:${active.customer_whatsapp.replace(/\s/g, "")}`} label="Call customer" />
              ) : (
                <span />
              )}
            </div>
            <div className="mt-3">
              {active.status === "accepted" && (
                <BigBtn icon={MapPin} label="I've arrived" busy={busyJob === active.id} onClick={() => act(active, "arrived")} />
              )}
              {active.status === "driver_arrived" && (
                <BigBtn icon={Users} label="Customer picked up" busy={busyJob === active.id} onClick={() => act(active, "start")} />
              )}
              {active.status === "in_progress" && (
                <BigBtn
                  icon={Flag}
                  label="Customer dropped off — complete"
                  tone="green"
                  busy={busyJob === active.id}
                  onClick={() =>
                    active.payment_method === "cash" && active.payment_status !== "paid"
                      ? setCompleting(active)
                      : act(active, "complete")
                  }
                />
              )}
              {active.status === "accepted" && (
                <button
                  onClick={() => act(active, "decline")}
                  disabled={busyJob === active.id}
                  className="mt-2 w-full rounded-xl py-2 text-sm font-semibold text-gray-500"
                >
                  Can&apos;t do this job
                </button>
              )}
            </div>
          </JobCard>
        )}

        {/* New / upcoming jobs */}
        {offers.length > 0 && (
          <p className="px-1 pt-2 text-xs font-bold uppercase tracking-wide text-gray-500">
            {offers.length === 1 ? "New job" : `New jobs (${offers.length})`}
          </p>
        )}
        {offers.map((job) => (
          <JobCard key={job.id} job={job} highlight={job.id === focusJob}>
            <div className="mt-3">
              <ActiveJobMap job={job} me={position} />
            </div>
            <div className="mt-3">
              <LinkBtn icon={Navigation} href={navUrl(job.pickup_lat, job.pickup_lng, job.pickup_address)} label="Directions to pick-up" />
            </div>
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <BigBtn
                icon={Car}
                label={active ? "Finish your current job first" : "Accept — on my way"}
                busy={busyJob === job.id}
                disabled={!!active}
                onClick={() => act(job, "accept")}
              />
              <button
                onClick={() => act(job, "decline")}
                disabled={busyJob === job.id}
                className="rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-600"
              >
                Decline
              </button>
            </div>
          </JobCard>
        ))}

        {!active && offers.length === 0 && (
          <div className="rounded-2xl bg-white px-5 py-10 text-center shadow-sm">
            <CircleDot className={cn("mx-auto mb-3 h-8 w-8", online ? "text-green-600" : "text-gray-300")} />
            <p className="font-display text-base font-bold text-ink-950">No jobs right now</p>
            <p className="mt-1 text-sm text-gray-500">
              {online ? "Stay online — new jobs appear here with a sound." : "Go online to start receiving jobs."}
            </p>
            {scheduled.length > 0 && (
              <button onClick={() => setTab("scheduled")} className="mt-3 text-sm font-semibold text-brand-600">
                {scheduled.length} pre-booked {scheduled.length === 1 ? "job" : "jobs"} in Scheduled →
              </button>
            )}
          </div>
        )}
      </div>

      {/* Cash check before completing */}
      {completing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4" onClick={() => setCompleting(null)}>
          <div className="w-full max-w-lg rounded-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <p className="font-display text-lg font-bold text-ink-950">Collect the cash</p>
            <p className="mt-1 text-sm text-gray-500">
              Fare for {completing.booking_number}:{" "}
              <b className="text-ink-950">{money(completing.final_fare ?? completing.estimated_fare ?? 0)}</b>
            </p>
            <div className="mt-4 space-y-2">
              <BigBtn
                icon={Banknote}
                label="Cash collected — complete"
                tone="green"
                busy={busyJob === completing.id}
                onClick={async () => {
                  const j = completing;
                  setCompleting(null);
                  await act(j, "complete", true);
                }}
              />
              <button
                onClick={async () => {
                  const j = completing;
                  setCompleting(null);
                  await act(j, "complete", false);
                }}
                className="w-full rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-600"
              >
                Not paid — complete and tell the office
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function JobCard({ job, highlight, children }: { job: Job; highlight?: boolean; children: React.ReactNode }) {
  const vias = (job.via_points ?? []).filter((v) => v?.address);
  const fare = job.final_fare ?? job.estimated_fare;
  return (
    <section className={cn("rounded-2xl bg-white p-4 shadow-sm", highlight && "ring-2 ring-brand-500")}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-gray-500">{job.booking_number}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{whenLabel(job.scheduled_at)}</span>
      </div>
      <div className="mt-3 space-y-2">
        <Line icon={MapPin} tone="text-green-600" text={job.pickup_address} />
        {vias.map((v, i) => (
          <Line key={i} icon={CircleDot} tone="text-gray-400" text={v.address} />
        ))}
        <Line icon={Navigation} tone="text-ink-950" text={job.dropoff_address} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
        <Chip icon={Users} text={`${job.passengers} pax · ${job.suitcases} cases`} />
        {job.category?.name && <Chip icon={Car} text={job.category.name} />}
        {job.child_seat && <Chip icon={Baby} text="Child seat" strong />}
        <Chip
          icon={job.payment_method === "cash" ? Banknote : CreditCard}
          text={
            job.payment_method === "cash"
              ? `Cash ${fare != null ? money(fare) : ""}`
              : job.payment_status === "paid"
                ? "Paid by card"
                : "Card"
          }
          strong={job.payment_method === "cash"}
        />
      </div>
      <p className="mt-2 text-sm font-semibold text-ink-950">{job.customer_name}</p>
      {job.notes?.trim() && (
        <p className="mt-1 flex items-start gap-1.5 text-sm text-gray-600">
          <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" /> {job.notes.trim()}
        </p>
      )}
      {children}
    </section>
  );
}

function ActiveSteps({ status }: { status: Job["status"] }) {
  const steps = [
    { key: "accepted", label: "On my way" },
    { key: "driver_arrived", label: "Arrived" },
    { key: "in_progress", label: "Picked up" },
  ];
  const at = steps.findIndex((s) => s.key === status);
  return (
    <ol className="mt-3 grid grid-cols-3 gap-1.5">
      {steps.map((s, i) => (
        <li
          key={s.key}
          className={cn(
            "flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-bold",
            i < at ? "bg-green-50 text-green-700" : i === at ? "bg-brand-500 text-white" : "bg-gray-100 text-gray-400"
          )}
        >
          {i < at && <Check className="h-3 w-3" />} {s.label}
        </li>
      ))}
    </ol>
  );
}

function Line({ icon: Icon, tone, text }: { icon: LucideIcon; tone: string; text: string }) {
  return (
    <p className="flex items-start gap-2 text-[15px] leading-snug text-ink-950">
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone)} /> <span>{text}</span>
    </p>
  );
}

function Chip({ icon: Icon, text, strong }: { icon: LucideIcon; text: string; strong?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-1 font-semibold",
        strong ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-600"
      )}
    >
      <Icon className="h-3.5 w-3.5" /> {text}
    </span>
  );
}

function BigBtn({
  icon: Icon,
  label,
  onClick,
  busy,
  disabled,
  tone = "brand",
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "brand" | "green";
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-[15px] font-bold text-white shadow-sm transition-colors disabled:bg-gray-300 disabled:shadow-none",
        tone === "green" ? "bg-green-600 active:bg-green-700" : "bg-brand-500 active:bg-brand-600"
      )}
    >
      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />} {label}
    </button>
  );
}

function LinkBtn({ icon: Icon, href, label }: { icon: LucideIcon; href: string; label: string }) {
  return (
    <a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel="noopener noreferrer"
      className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-semibold text-ink-950"
    >
      <Icon className="h-4 w-4 text-brand-600" /> {label}
    </a>
  );
}

function Notice({
  icon: Icon,
  text,
  tone,
  action,
}: {
  icon: LucideIcon;
  text: string;
  tone: "amber" | "red";
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl px-4 py-3 text-sm",
        tone === "amber" ? "bg-brand-50 text-brand-900" : "bg-red-50 text-red-800"
      )}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p>{text}</p>
        {action && (
          <button onClick={action.onClick} className="mt-2 rounded-lg bg-ink-950 px-3 py-1.5 text-xs font-bold text-white">
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

/** Map for a job: route to the pick-up until the customer is on board, then to the drop-off. */
function ActiveJobMap({ job, me }: { job: Job; me: { lat: number; lng: number } | null }) {
  const pickup = useMemo(
    () => (job.pickup_lat != null && job.pickup_lng != null ? { lat: job.pickup_lat, lng: job.pickup_lng } : null),
    [job.pickup_lat, job.pickup_lng]
  );
  const dropoff = useMemo(
    () => (job.dropoff_lat != null && job.dropoff_lng != null ? { lat: job.dropoff_lat, lng: job.dropoff_lng } : null),
    [job.dropoff_lat, job.dropoff_lng]
  );
  const viaKey = JSON.stringify(job.via_points ?? []);
  const vias = useMemo(
    () =>
      (JSON.parse(viaKey) as { lat: number | null; lng: number | null }[])
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => ({ lat: v.lat as number, lng: v.lng as number })),
    [viaKey]
  );
  return (
    <JobMap
      me={me}
      pickup={pickup}
      dropoff={dropoff}
      vias={vias}
      stage={job.status === "in_progress" ? "to_dropoff" : "to_pickup"}
    />
  );
}

type Supa = ReturnType<typeof createClient>;

interface PastJob {
  id: string;
  booking_number: string;
  status: "completed" | "cancelled";
  pickup_address: string;
  dropoff_address: string;
  scheduled_at: string | null;
  created_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  payment_method: "cash" | "card";
  payment_status: string;
  estimated_fare: number | null;
  final_fare: number | null;
  cash_settled: boolean | null;
}

const PAST_FIELDS =
  "id, booking_number, status, pickup_address, dropoff_address, scheduled_at, created_at, completed_at, cancelled_at, payment_method, payment_status, estimated_fare, final_fare, cash_settled";

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const ukDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London" });
const fareOf = (j: PastJob) => Number(j.final_fare ?? j.estimated_fare ?? 0);

/** Completed and cancelled jobs, newest first, with today's totals. */
function HistoryTab({ supabase }: { supabase: Supa }) {
  const [rows, setRows] = useState<PastJob[] | null>(null);
  const [filter, setFilter] = useState<"completed" | "cancelled">("completed");

  useEffect(() => {
    supabase
      .from("bookings")
      .select(PAST_FIELDS)
      .in("status", ["completed", "cancelled"])
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => setRows((data as PastJob[]) ?? []));
  }, [supabase]);

  if (!rows) return <Spinner />;
  const today = ukDay(new Date().toISOString());
  const doneToday = rows.filter((j) => j.status === "completed" && j.completed_at && ukDay(j.completed_at) === today);
  const list = rows.filter((j) => j.status === filter);

  return (
    <div className="mx-auto max-w-lg space-y-3 px-4 pt-4">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Jobs today" value={String(doneToday.length)} />
        <Stat label="Fares today" value={money(doneToday.reduce((s, j) => s + fareOf(j), 0))} />
      </div>
      <div className="flex gap-2">
        {(["completed", "cancelled"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold capitalize",
              filter === k ? "bg-ink-950 text-white" : "bg-white text-gray-500"
            )}
          >
            {k} ({rows.filter((j) => j.status === k).length})
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="rounded-2xl bg-white px-5 py-10 text-center text-sm text-gray-400">No {filter} jobs yet.</p>
      ) : (
        list.map((j) => (
          <div key={j.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono font-semibold text-gray-500">{j.booking_number}</span>
              <span className="text-gray-400">{dayLabel(j.completed_at ?? j.cancelled_at ?? j.created_at)}</span>
            </div>
            <p className="mt-2 truncate text-sm text-ink-950">{j.pickup_address}</p>
            <p className="truncate text-sm text-gray-500">→ {j.dropoff_address}</p>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-xs text-gray-500">
                {j.payment_method === "cash" ? "Cash" : "Card"}
                {j.payment_method === "cash" && j.status === "completed" && j.payment_status !== "paid"
                  ? " · not collected"
                  : ""}
              </span>
              <span
                className={cn(
                  "font-display font-bold",
                  j.status === "cancelled" ? "text-gray-400 line-through" : "text-ink-950"
                )}
              >
                {money(fareOf(j))}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}


/** Cash the driver has collected — today, the last 7 days, and recent cash jobs. */
function CashTab({ supabase }: { supabase: Supa }) {
  const [rows, setRows] = useState<PastJob[] | null>(null);
  const [since] = useState(() => new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString());

  useEffect(() => {
    supabase
      .from("bookings")
      .select(PAST_FIELDS)
      .eq("status", "completed")
      .eq("payment_method", "cash")
      .eq("payment_status", "paid")
      .gte("completed_at", since)
      .order("completed_at", { ascending: false })
      .then(({ data }) => setRows((data as PastJob[]) ?? []));
  }, [supabase, since]);

  if (!rows) return <Spinner />;
  const today = ukDay(new Date().toISOString());
  const weekAgo = new Date(since).getTime() + 23 * 24 * 60 * 60_000;
  const todayRows = rows.filter((j) => j.completed_at && ukDay(j.completed_at) === today);
  const weekRows = rows.filter((j) => j.completed_at && new Date(j.completed_at).getTime() >= weekAgo);
  const sum = (list: PastJob[]) => list.reduce((s, j) => s + fareOf(j), 0);

  return (
    <div className="mx-auto max-w-lg space-y-3 px-4 pt-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-ink-950 p-4 text-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Cash today</p>
          <p className="mt-1 font-display text-2xl font-extrabold">{money(sum(todayRows))}</p>
          <p className="text-xs text-gray-400">
            {todayRows.length} {todayRows.length === 1 ? "job" : "jobs"}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Last 7 days</p>
          <p className="mt-1 font-display text-2xl font-extrabold text-ink-950">{money(sum(weekRows))}</p>
          <p className="text-xs text-gray-400">
            {weekRows.length} {weekRows.length === 1 ? "job" : "jobs"}
          </p>
        </div>
      </div>
      <p className="px-1 pt-2 text-xs font-bold uppercase tracking-wide text-gray-500">Cash jobs — last 30 days</p>
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-white px-5 py-10 text-center text-sm text-gray-400">No cash jobs in the last 30 days.</p>
      ) : (
        rows.map((j) => (
          <div key={j.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm">
            <div className="min-w-0">
              <p className="font-mono text-xs font-semibold text-gray-500">{j.booking_number}</p>
              <p className="truncate text-sm text-ink-950">{j.pickup_address}</p>
              <p className="text-xs text-gray-400">{j.completed_at ? dayLabel(j.completed_at) : ""}</p>
            </div>
            <span className="font-display font-bold text-ink-950">{money(fareOf(j))}</span>
          </div>
        ))
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="font-display text-xl font-bold text-ink-950">{value}</p>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
    </div>
  );
}
