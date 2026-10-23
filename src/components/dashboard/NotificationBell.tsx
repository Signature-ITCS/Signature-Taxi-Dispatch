"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  BellRing,
  Check,
  CheckCircle2,
  XCircle,
  UserCheck,
  MapPin,
  Users,
  Flag,
  CreditCard,
  AlarmClock,
  PlusCircle,
  Ban,
  X,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn, timeAgo } from "@/lib/format";

interface Note {
  id: string;
  created_at: string;
  kind: string;
  severity: "info" | "good" | "warn" | "urgent";
  title: string;
  body: string | null;
  booking_id: string | null;
}

const ICON: Record<string, LucideIcon> = {
  new: PlusCircle,
  assigned: UserCheck,
  accepted: CheckCircle2,
  declined: XCircle,
  arrived: MapPin,
  picked_up: Users,
  completed: Flag,
  cancelled: Ban,
  paid: CreditCard,
  reminder: AlarmClock,
};

const TONE: Record<Note["severity"], string> = {
  info: "bg-blue-50 text-blue-600",
  good: "bg-green-50 text-green-600",
  warn: "bg-brand-50 text-brand-600",
  urgent: "bg-red-50 text-red-600",
};

/** Kinds whose job has usually left the live board — open them in Bookings instead. */
const CLOSED_KINDS = new Set(["completed", "cancelled", "paid"]);

/**
 * The staff 🔔: every change to every job, as it happens (written by the
 * database — see db/2026-10-15_notifications.sql). Unread is per person:
 * opening the list marks everything up to now as seen for whoever opened it.
 */
/**
 * Mount both — the sidebar bell on computers, the floating one on phones. Only
 * the one that fits the screen actually runs, so there is one live connection
 * and one chime, never two.
 */
export default function NotificationBell({ variant }: { variant: "sidebar" | "floating" }) {
  const [fits, setFits] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setFits(variant === "sidebar" ? mq.matches : !mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [variant]);
  return fits ? <Bell_ variant={variant} /> : null;
}

function Bell_({ variant }: { variant: "sidebar" | "floating" }) {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const pathname = usePathname();
  const base = pathname.startsWith("/admin") ? "/admin" : "/dispatch";

  const [userId, setUserId] = useState<string | null>(null);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  // What was unread when the panel opened — kept highlighted while it's open.
  const [highlightSince, setHighlightSince] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Where the sidebar panel opens. The panel is drawn on <body> so nothing on
  // the page (map, modals) can cover it.
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  const load = useCallback(
    async (since: string | null) => {
      const [{ data }, { count }] = await Promise.all([
        supabase.from("staff_notifications").select("*").order("created_at", { ascending: false }).limit(40),
        since
          ? supabase.from("staff_notifications").select("id", { count: "exact", head: true }).gt("created_at", since)
          : Promise.resolve({ count: 0 }),
      ]);
      setNotes((data as Note[]) ?? []);
      setUnread(count ?? 0);
    },
    [supabase]
  );

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const { data: p } = await supabase.from("profiles").select("notifications_seen_at").eq("id", user.id).maybeSingle();
      const since = (p?.notifications_seen_at as string | null) ?? null;
      setSeenAt(since);
      load(since);
    })();
  }, [supabase, load]);

  // Live: new notifications appear at once, with a short chime.
  useEffect(() => {
    const ch = supabase
      .channel("staff-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "staff_notifications" }, (msg) => {
        const n = msg.new as Note;
        setNotes((list) => (list ? [n, ...list.filter((x) => x.id !== n.id)].slice(0, 40) : list));
        setUnread((u) => u + 1);
        chime(n.severity === "urgent");
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [supabase]);

  // Close on a click outside.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    if (next && box.current) {
      const r = box.current.getBoundingClientRect();
      setAnchor({ top: r.bottom + 8, left: r.left });
    }
    setOpen(next);
    if (!next || !userId) return;
    setHighlightSince(seenAt);
    if (unread === 0) return;
    const now = new Date().toISOString();
    setUnread(0);
    setSeenAt(now);
    await supabase.from("profiles").update({ notifications_seen_at: now }).eq("id", userId);
  };

  const go = (n: Note) => {
    setOpen(false);
    if (!n.booking_id) return;
    if (CLOSED_KINDS.has(n.kind)) router.push(`${base}/bookings?q=${encodeURIComponent(refOf(n))}`);
    else router.push(`${base === "/admin" ? "/admin/dispatch" : "/dispatch"}?job=${n.booking_id}`);
  };

  const button = (
    <button
      type="button"
      onClick={toggle}
      aria-label={unread ? `${unread} new notifications` : "Notifications"}
      className={cn(
        "relative flex items-center justify-center rounded-full transition-colors",
        variant === "floating"
          ? "h-12 w-12 bg-ink-950 text-white shadow-lg shadow-black/25"
          : "h-9 w-9 text-gray-500 hover:bg-gray-100 hover:text-ink-950"
      )}
    >
      {unread ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white ring-2 ring-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );

  return (
    <div ref={box} className={cn("relative", variant === "floating" && "fixed z-40", variant === "floating" && FLOAT_POS)}>
      {button}
      {open &&
        createPortal(
          <div
          ref={panel}
          style={variant === "sidebar" && anchor ? { top: anchor.top, left: anchor.left } : undefined}
          className={cn(
            "z-[2147483000] flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl",
            variant === "floating"
              ? "fixed inset-x-3 bottom-[calc(140px+env(safe-area-inset-bottom))] md:bottom-20 md:left-auto md:right-4 md:w-96"
              : "fixed w-96 max-w-[calc(100vw-2rem)]"
          )}
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <p className="font-display text-base font-bold text-ink-950">Notifications</p>
            <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {notes === null ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
              </div>
            ) : notes.length === 0 ? (
              <p className="flex flex-col items-center gap-2 py-10 text-sm text-gray-400">
                <Check className="h-6 w-6" /> Nothing yet — job updates will appear here.
              </p>
            ) : (
              notes.map((n) => {
                const Icon = ICON[n.kind] ?? Bell;
                const isNew = !!highlightSince && n.created_at > highlightSince;
                return (
                  <button
                    key={n.id}
                    onClick={() => go(n)}
                    className={cn(
                      "flex w-full items-start gap-3 border-b border-gray-50 px-4 py-3 text-left transition-colors last:border-0 hover:bg-gray-50",
                      isNew && "bg-brand-50/50"
                    )}
                  >
                    <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", TONE[n.severity] ?? TONE.info)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm text-ink-950", isNew ? "font-bold" : "font-medium")}>{n.title}</span>
                      {n.body && <span className="block truncate text-xs text-gray-500">{n.body}</span>}
                      <span className="block text-[11px] text-gray-400">{timeAgo(n.created_at)}</span>
                    </span>
                    {isNew && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                  </button>
                );
              })
            )}
          </div>
        </div>,
          document.body
        )}
    </div>
  );
}

/** Phones: above the dispatch tab bar; desktop admin: bottom-right corner. */
const FLOAT_POS = "right-4 bottom-[calc(76px+env(safe-area-inset-bottom))]";

/** "TX261015-1004-ABC123" from the title, for the Bookings search. */
function refOf(n: Note): string {
  return n.title.match(/TX\d{6}-\d+-[A-Z0-9]+/)?.[0] ?? "";
}

function chime(urgent: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    (urgent ? [0, 0.18, 0.36] : [0]).forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = urgent ? 990 : 740;
      g.gain.setValueAtTime(0.001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.25);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.3);
    });
  } catch {
    /* sound unavailable */
  }
}
