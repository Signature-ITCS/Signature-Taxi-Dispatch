import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Partner network: independent drivers and sole-trader operators that
 * companies can contact to cover a job. Server-only.
 *
 * The tables have no access rules for any login (db/2026-10-29_partner_network.sql);
 * everything goes through here. Companies see a partner only while it is
 * approved, paid up and its licences are in date, and never its phone number
 * or email in the list — the number is handed out one at a time on
 * "WhatsApp", and logged.
 */

export interface Partner {
  id: string;
  user_id: string | null;
  status: "pending" | "active" | "disabled";
  full_name: string;
  email: string;
  phone: string;
  kind: "driver" | "operator";
  council: string;
  badge_number: string;
  badge_expires: string;
  vehicle_type: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_colour: string | null;
  vehicle_seats: number | null;
  plate_number: string | null;
  vehicle_licence_number: string | null;
  vehicle_licence_expires: string | null;
  operator_licence_number: string | null;
  operator_council: string | null;
  operator_licence_expires: string | null;
  areas: string;
  about: string | null;
  available: boolean;
  available_until: string | null;
  available_changed_at: string | null;
  paid_until: string | null;
  owner_notes: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

/** "Available now" switches itself off after this long. */
export const AVAILABLE_HOURS = 12;

export const ukToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

/** Why a partner isn't in the directory (null = listed). */
export function notListedBecause(p: Partner, today = ukToday()): string | null {
  if (p.status === "pending") return "waiting for approval";
  if (p.status === "disabled") return "disabled";
  if (!p.paid_until || p.paid_until < today) return "not paid up";
  if (p.badge_expires < today) return "driver licence expired";
  if (p.vehicle_licence_expires && p.vehicle_licence_expires < today) return "vehicle licence expired";
  if (p.kind === "operator" && p.operator_licence_expires && p.operator_licence_expires < today) return "operator licence expired";
  return null;
}
export const isListed = (p: Partner, today = ukToday()) => notListedBecause(p, today) === null;

export const isAvailable = (p: Pick<Partner, "available" | "available_until">) =>
  p.available && (!p.available_until || new Date(p.available_until).getTime() > Date.now());

/** What a company sees in the directory — no phone, no email, no private notes. */
export function directoryView(p: Partner) {
  return {
    id: p.id,
    full_name: p.full_name,
    kind: p.kind,
    council: p.council,
    badge_number: p.badge_number,
    badge_expires: p.badge_expires,
    vehicle_type: p.vehicle_type,
    vehicle: [p.vehicle_colour, p.vehicle_make, p.vehicle_model].filter(Boolean).join(" ") || null,
    vehicle_seats: p.vehicle_seats,
    plate_number: p.plate_number,
    vehicle_licence_number: p.vehicle_licence_number,
    vehicle_licence_expires: p.vehicle_licence_expires,
    operator_licence_number: p.kind === "operator" ? p.operator_licence_number : null,
    operator_council: p.kind === "operator" ? p.operator_council : null,
    operator_licence_expires: p.kind === "operator" ? p.operator_licence_expires : null,
    areas: p.areas,
    about: p.about,
    available: isAvailable(p),
    available_changed_at: p.available_changed_at,
  };
}

export async function getPartnerByUser(userId: string): Promise<Partner | null> {
  const { data } = await createAdminClient().from("partners").select("*").eq("user_id", userId).maybeSingle();
  return (data as Partner) ?? null;
}

export async function partnerPrice(): Promise<number> {
  const { data } = await createAdminClient().from("platform_settings").select("value").eq("key", "partners").maybeSingle();
  return Number((data?.value as { monthly_price?: number } | null)?.monthly_price ?? 0) || 0;
}

/** WhatsApp link for a UK-style number (07… → 447…). */
export function whatsappLink(phone: string, text?: string): string {
  const d = phone.replace(/\D/g, "");
  const n = d.startsWith("0") ? `44${d.slice(1)}` : d;
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Licensing authorities companies often filter by (free text is allowed too). */
export const COMMON_COUNCILS = [
  "Transport for London",
  "Birmingham City Council",
  "Manchester City Council",
  "Leeds City Council",
  "Liverpool City Council",
  "Bristol City Council",
  "Sheffield City Council",
  "Wolverhampton City Council",
  "Reading Borough Council",
  "Slough Borough Council",
  "Glasgow City Council",
  "City of Edinburgh Council",
  "Cardiff Council",
];
