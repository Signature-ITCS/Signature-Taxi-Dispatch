"use client";

import HelpLink from "@/components/docs/HelpLink";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Layer } from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Loader2,
  Plus,
  Save,
  Check,
  Trash2,
  Undo2,
  X,
  Pencil,
  ArrowLeftRight,
  ArrowRight,
  MapPin,
  Navigation,
  Calculator,
  Shapes,
  Moon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLeaflet, createMap } from "@/lib/leafletMap";
import AddressAutocomplete, { type PlaceValue } from "@/components/booking/AddressAutocomplete";
import { cn, money } from "@/lib/format";
import { logActivity } from "@/lib/activity";
import type { VehicleCategory } from "@/lib/types";

/**
 * Admin → Pricing → "Fixed prices between areas".
 *
 * Areas are drawn on the map (click to add corners). A fixed route says
 * "From area → To area costs £X" per vehicle type; with "both ways" the reverse
 * trip (and the return leg) costs the same. Everything else uses the per-mile
 * pricing. The maths lives in the database (estimate_fare) — see
 * db/2026-10-19_fixed_prices.sql.
 */

type LatLng = [number, number];
interface Zone {
  id: string;
  name: string;
  color: string;
  polygon: LatLng[];
  is_active: boolean;
}
interface Route {
  id: string;
  from_zone_id: string;
  to_zone_id: string;
  both_ways: boolean;
  prices: Record<string, number>;
  is_active: boolean;
  /** Night rate / time-based charges are added on this route (db/2026-10-22_route_night_rate.sql). */
  time_charges?: boolean;
}
type RouteDraft = Omit<Route, "id"> & { id: string | null };

const COLORS = ["#1d4ed8", "#2563eb", "#16a34a", "#9333ea", "#dc2626", "#0891b2", "#ca8a04", "#db2777"];

export default function FixedPrices({ cats }: { cats: VehicleCategory[] }) {
  const [supabase] = useState(() => createClient());
  const [zones, setZones] = useState<Zone[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [addExtras, setAddExtras] = useState(false);
  const [loading, setLoading] = useState(true);
  const [missingTables, setMissingTables] = useState(false);
  // Has db/2026-10-22_route_night_rate.sql been run? Until then the per-route
  // night-rate tick is hidden and never sent, so saving routes keeps working.
  const [hasNightCol, setHasNightCol] = useState(false);

  // Drawing state
  const [editing, setEditing] = useState<{ id: string | null; name: string; color: string; points: LatLng[] } | null>(null);
  const [savingZone, setSavingZone] = useState(false);
  const [zoneError, setZoneError] = useState<string | null>(null);

  // Route editing
  const [draft, setDraft] = useState<RouteDraft | null>(null);
  const [savingRoute, setSavingRoute] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [z, r, s, col] = await Promise.all([
      supabase.from("pricing_zones").select("*").order("sort_order").order("created_at"),
      supabase.from("fixed_routes").select("*").order("sort_order").order("created_at"),
      supabase.from("app_settings").select("value").eq("key", "fixed_prices").maybeSingle(),
      supabase.from("fixed_routes").select("time_charges").limit(1),
    ]);
    setHasNightCol(!col.error);
    if (z.error || r.error) {
      setMissingTables(true);
      setLoading(false);
      return;
    }
    setZones((z.data as Zone[]) ?? []);
    setRoutes((r.data as Route[]) ?? []);
    setAddExtras(!!(s.data?.value as { add_extras?: boolean } | null)?.add_extras);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const zoneName = (id: string) => zones.find((z) => z.id === id)?.name ?? "—";

  // ── Areas ──
  const startNew = () => {
    setZoneError(null);
    setEditing({ id: null, name: "", color: COLORS[zones.length % COLORS.length], points: [] });
  };
  const startEdit = (z: Zone) => {
    setZoneError(null);
    setEditing({ id: z.id, name: z.name, color: z.color, points: [...z.polygon] });
  };
  const saveZone = async () => {
    if (!editing) return;
    if (!editing.name.trim()) return setZoneError("Give the area a name.");
    if (editing.points.length < 3) return setZoneError("Click at least 3 corners on the map.");
    setSavingZone(true);
    setZoneError(null);
    const row = { name: editing.name.trim(), color: editing.color, polygon: editing.points };
    const { error } = editing.id
      ? await supabase.from("pricing_zones").update(row).eq("id", editing.id)
      : await supabase.from("pricing_zones").insert(row);
    setSavingZone(false);
    if (error) return setZoneError("Could not save the area. Please try again.");
    await logActivity(supabase, "pricing_updated", `${editing.id ? "Updated" : "Added"} pricing area ${row.name}`);
    setEditing(null);
    load();
  };
  const toggleZone = async (z: Zone) => {
    await supabase.from("pricing_zones").update({ is_active: !z.is_active }).eq("id", z.id);
    load();
  };
  const deleteZone = async (z: Zone) => {
    const used = routes.filter((r) => r.from_zone_id === z.id || r.to_zone_id === z.id).length;
    if (!confirm(`Delete the area "${z.name}"?${used ? `\n\nThis also deletes ${used} fixed route(s) that use it.` : ""}`)) return;
    await supabase.from("pricing_zones").delete().eq("id", z.id);
    await logActivity(supabase, "pricing_updated", `Deleted pricing area ${z.name}`);
    load();
  };

  // ── Routes ──
  const newRoute = () => {
    setRouteError(null);
    setDraft({ id: null, from_zone_id: zones[0]?.id ?? "", to_zone_id: zones[1]?.id ?? "", both_ways: true, prices: {}, is_active: true, time_charges: false });
  };
  const saveRoute = async () => {
    if (!draft) return;
    if (!draft.from_zone_id || !draft.to_zone_id) return setRouteError("Choose both areas.");
    if (draft.from_zone_id === draft.to_zone_id) return setRouteError("From and To must be different areas.");
    const prices = Object.fromEntries(
      Object.entries(draft.prices).filter(([, v]) => Number.isFinite(v) && v > 0).map(([k, v]) => [k, Math.round(v)])
    );
    if (Object.keys(prices).length === 0) return setRouteError("Enter a price for at least one vehicle type.");
    setSavingRoute(true);
    setRouteError(null);
    const row = {
      from_zone_id: draft.from_zone_id,
      to_zone_id: draft.to_zone_id,
      both_ways: draft.both_ways,
      prices,
      is_active: draft.is_active,
      ...(hasNightCol ? { time_charges: !!draft.time_charges } : {}),
    };
    const { error } = draft.id
      ? await supabase.from("fixed_routes").update(row).eq("id", draft.id)
      : await supabase.from("fixed_routes").insert(row);
    setSavingRoute(false);
    if (error) return setRouteError("Could not save the route. Please try again.");
    await logActivity(
      supabase,
      "pricing_updated",
      `${draft.id ? "Updated" : "Added"} fixed price ${zoneName(row.from_zone_id)} ${row.both_ways ? "↔" : "→"} ${zoneName(row.to_zone_id)}`
    );
    setDraft(null);
    load();
  };
  const toggleRoute = async (r: Route) => {
    await supabase.from("fixed_routes").update({ is_active: !r.is_active }).eq("id", r.id);
    load();
  };
  const deleteRoute = async (r: Route) => {
    if (!confirm(`Delete the fixed price ${zoneName(r.from_zone_id)} → ${zoneName(r.to_zone_id)}?`)) return;
    await supabase.from("fixed_routes").delete().eq("id", r.id);
    await logActivity(supabase, "pricing_updated", `Deleted fixed price ${zoneName(r.from_zone_id)} → ${zoneName(r.to_zone_id)}`);
    load();
  };

  const saveAddExtras = async (v: boolean) => {
    setAddExtras(v);
    await supabase.from("app_settings").upsert({ key: "fixed_prices", value: { add_extras: v } }, { onConflict: "company_id,key" });
    await logActivity(supabase, "pricing_updated", `Fixed prices: extra charges ${v ? "added on top" : "not added"}`);
  };

  if (loading) {
    return (
      <section className="flex h-40 items-center justify-center rounded-2xl border border-gray-100 bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </section>
    );
  }

  return (
    <section>
      <h2 className="mb-1 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-gray-400">
        <Shapes className="h-4 w-4 text-brand-500" /> Fixed prices between areas
      </h2>
      <p className="mb-3 max-w-3xl text-xs leading-relaxed text-gray-500">
        Draw areas on the map (e.g. Sheerness, Heathrow), then set a fixed price per vehicle from one area to another. A journey
        starting in the From area and ending in the To area (or the other way round, if <b>both ways</b> is ticked) costs that
        price. Stops that make the trip longer add the extra miles at the per-mile rate. Everything else uses the per-mile
        pricing. All fares are rounded to the nearest pound.
      </p>

      {missingTables ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Fixed prices aren&apos;t switched on yet: run <code className="rounded bg-white px-1">db/2026-10-19_fixed_prices.sql</code> in the
          Supabase SQL editor, then reload this page.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
            <ZoneMap zones={zones} editing={editing} onEditing={setEditing} />

            {/* Areas list / editor */}
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              {editing ? (
                <div className="space-y-3">
                  <p className="font-display font-bold text-ink-950">{editing.id ? "Edit area" : "New area"}</p>
                  <input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="Area name, e.g. Heathrow Airport"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/10"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setEditing({ ...editing, color: c })}
                        aria-label={`Colour ${c}`}
                        className={cn("h-6 w-6 rounded-full border-2", editing.color === c ? "border-ink-950" : "border-white")}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                  <p className="rounded-xl bg-brand-50 px-3 py-2 text-xs leading-relaxed text-brand-800">
                    <b>Click on the map</b> to add corners around the area ({editing.points.length} so far, need 3+). Drag a corner to
                    move it. Use the search box on the map to jump to a place.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditing({ ...editing, points: editing.points.slice(0, -1) })}
                      disabled={!editing.points.length}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2 text-xs font-semibold text-gray-600 disabled:opacity-40"
                    >
                      <Undo2 className="h-3.5 w-3.5" /> Undo corner
                    </button>
                    <button
                      onClick={() => setEditing({ ...editing, points: [] })}
                      disabled={!editing.points.length}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2 text-xs font-semibold text-gray-600 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Clear
                    </button>
                  </div>
                  {zoneError && <p className="text-xs text-red-600">{zoneError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditing(null)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2.5 text-sm font-semibold text-gray-600"
                    >
                      <X className="h-4 w-4" /> Cancel
                    </button>
                    <button
                      onClick={saveZone}
                      disabled={savingZone}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
                    >
                      {savingZone ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save area
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <p className="flex items-center gap-2 font-display font-bold text-ink-950">Areas <HelpLink to="fixed-prices#areas" /></p>
                    <button
                      onClick={startNew}
                      className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                    >
                      <Plus className="h-3.5 w-3.5" /> New area
                    </button>
                  </div>
                  {zones.length === 0 ? (
                    <p className="py-6 text-center text-sm text-gray-400">No areas yet — click New area and draw one on the map.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {zones.map((z) => (
                        <li key={z.id} className={cn("flex items-center gap-2 rounded-xl border border-gray-100 px-3 py-2", !z.is_active && "opacity-50")}>
                          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: z.color }} />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-950">{z.name}</span>
                          <Toggle on={z.is_active} onClick={() => toggleZone(z)} label={z.name} />
                          <button onClick={() => startEdit(z)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-ink-950" aria-label={`Edit ${z.name}`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => deleteZone(z)} className="rounded-lg p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${z.name}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Routes */}
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 font-display font-bold text-ink-950">Fixed routes <HelpLink to="fixed-prices#routes" /></p>
              <button
                onClick={newRoute}
                disabled={zones.length < 2 || !!draft}
                title={zones.length < 2 ? "Draw at least two areas first" : undefined}
                className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" /> Add fixed route
              </button>
            </div>

            {draft && (
              <RouteEditor
                draft={draft}
                zones={zones}
                cats={cats}
                nightAvailable={hasNightCol}
                saving={savingRoute}
                error={routeError}
                onChange={setDraft}
                onCancel={() => setDraft(null)}
                onSave={saveRoute}
              />
            )}

            {routes.length === 0 && !draft ? (
              <p className="py-6 text-center text-sm text-gray-400">
                {zones.length < 2 ? "Draw at least two areas, then add a fixed route between them." : "No fixed routes yet."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      <th className="py-2 pr-3">Route</th>
                      {cats.map((c) => (
                        <th key={c.id} className={cn("px-2 py-2 text-right", !c.is_active && "text-gray-300")}>
                          {c.name}
                        </th>
                      ))}
                      <th className="px-2 py-2 text-center">On</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {routes.map((r) => (
                      <tr key={r.id} className={cn("border-b border-gray-50 last:border-0", !r.is_active && "opacity-50")}>
                        <td className="py-2.5 pr-3 font-medium text-ink-950">
                          <span className="inline-flex items-center gap-1.5">
                            {zoneName(r.from_zone_id)}
                            {r.both_ways ? <ArrowLeftRight className="h-3.5 w-3.5 text-brand-600" /> : <ArrowRight className="h-3.5 w-3.5 text-gray-400" />}
                            {zoneName(r.to_zone_id)}
                            {r.time_charges && (
                              <span title="Night rate / time-based charges apply" className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                                <Moon className="h-3 w-3" /> Night
                              </span>
                            )}
                          </span>
                        </td>
                        {cats.map((c) => (
                          <td key={c.id} className="px-2 py-2.5 text-right tabular-nums">
                            {r.prices[c.id] ? money(r.prices[c.id]) : <span className="text-xs text-gray-300">per mile</span>}
                          </td>
                        ))}
                        <td className="px-2 py-2.5 text-center">
                          <Toggle on={r.is_active} onClick={() => toggleRoute(r)} label="route" />
                        </td>
                        <td className="whitespace-nowrap py-2.5 pl-2 text-right">
                          <button
                            onClick={() => {
                              setRouteError(null);
                              setDraft({ ...r });
                            }}
                            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-ink-950"
                            aria-label="Edit route"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => deleteRoute(r)} className="rounded-lg p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete route">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-700">
              <input type="checkbox" checked={addExtras} onChange={(e) => saveAddExtras(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
              <span>
                Also add <b>all extra charges</b> (night rate, airport fee…) on top of <b>every</b> fixed price
                <span className="block text-xs text-gray-400">
                  Off: fixed prices are all-in — except routes ticked <b>Night rate</b>, which get only time-based charges (e.g. 23:00–06:00). A child seat is always added when asked for.
                </span>
              </span>
            </label>
          </div>

          <JourneyTester />
        </div>
      )}
    </section>
  );
}

function RouteEditor({
  draft,
  zones,
  cats,
  nightAvailable,
  saving,
  error,
  onChange,
  onCancel,
  onSave,
}: {
  draft: RouteDraft;
  zones: Zone[];
  cats: VehicleCategory[];
  nightAvailable: boolean;
  saving: boolean;
  error: string | null;
  onChange: (d: RouteDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const sel = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400";
  return (
    <div className="mb-4 space-y-3 rounded-2xl border border-brand-200 bg-brand-50/40 p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">From area</span>
          <select value={draft.from_zone_id} onChange={(e) => onChange({ ...draft, from_zone_id: e.target.value })} className={sel}>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
        <span className="hidden pb-2.5 sm:block">
          {draft.both_ways ? <ArrowLeftRight className="h-4 w-4 text-brand-600" /> : <ArrowRight className="h-4 w-4 text-gray-400" />}
        </span>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">To area</span>
          <select value={draft.to_zone_id} onChange={(e) => onChange({ ...draft, to_zone_id: e.target.value })} className={sel}>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={draft.both_ways} onChange={(e) => onChange({ ...draft, both_ways: e.target.checked })} className="h-4 w-4 accent-brand-600" />
        <b>Both ways</b> — the reverse journey and returns cost the same
      </label>
      {nightAvailable && (
        <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={!!draft.time_charges}
            onChange={(e) => onChange({ ...draft, time_charges: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-brand-600"
          />
          <span>
            <b>Night rate / time-based charges apply</b> on this route
            <span className="block text-xs text-gray-400">
              e.g. a +20% charge for 23:00–06:00 in Extra charges is added at night. Airport and other non-time charges are not.
            </span>
          </span>
        </label>
      )}
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Price per vehicle (whole £ — leave blank for per-mile)</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {cats.map((c) => (
            <label key={c.id} className={cn("block", !c.is_active && "opacity-60")}>
              <span className="mb-0.5 block truncate text-xs text-gray-500">
                {c.name}
                {!c.is_active && " (off)"}
              </span>
              <div className="flex items-center rounded-xl border border-gray-200 bg-white px-2.5 focus-within:border-brand-400">
                <span className="text-sm text-gray-400">£</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={draft.prices[c.id] ?? ""}
                  onChange={(e) => {
                    const prices = { ...draft.prices };
                    if (e.target.value === "") delete prices[c.id];
                    else prices[c.id] = Math.max(0, Number(e.target.value));
                    onChange({ ...draft, prices });
                  }}
                  className="w-full bg-transparent px-1.5 py-2 text-sm outline-none"
                />
              </div>
            </label>
          ))}
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-600">
          Cancel
        </button>
        <button onClick={onSave} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save route
        </button>
      </div>
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={on ? `Turn off ${label}` : `Turn on ${label}`}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-brand-500" : "bg-gray-200")}
    >
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

/** Map with every area; while drawing, clicks add corners and corners can be dragged. */
function ZoneMap({
  zones,
  editing,
  onEditing,
}: {
  zones: Zone[];
  editing: { id: string | null; name: string; color: string; points: LatLng[] } | null;
  onEditing: (e: { id: string | null; name: string; color: string; points: LatLng[] } | null) => void;
}) {
  const { L, error } = useLeaflet();
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layers = useRef<Layer[]>([]);
  const fitted = useRef(false);
  // Latest editing state for the map's click handler.
  const editRef = useRef(editing);
  const [search, setSearch] = useState("");

  useEffect(() => {
    editRef.current = editing;
  }, [editing]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    []
  );

  useEffect(() => {
    if (!L || !el.current) return;
    if (!mapRef.current) {
      const map = createMap(L, el.current, { zoom: 10, scrollWheelZoom: true });
      map.setView([51.42, 0.75], 10); // Sheppey
      map.on("click", (e) => {
        const cur = editRef.current;
        if (!cur) return;
        onEditing({ ...cur, points: [...cur.points, [round6(e.latlng.lat), round6(e.latlng.lng)]] });
      });
      mapRef.current = map;
    }
    const map = mapRef.current;
    layers.current.forEach((l) => l.remove());
    layers.current = [];
    const add = (l: Layer) => {
      l.addTo(map);
      layers.current.push(l);
    };

    for (const z of zones) {
      if (editing?.id === z.id || z.polygon.length < 3) continue;
      add(
        L.polygon(z.polygon, { color: z.color, weight: 2, fillOpacity: z.is_active ? 0.18 : 0.05, dashArray: z.is_active ? undefined : "4 4" })
          .bindTooltip(z.name, { permanent: true, direction: "center", className: "bf-zone-label" })
      );
    }

    if (editing) {
      const pts = editing.points;
      if (pts.length >= 3) add(L.polygon(pts, { color: editing.color, weight: 3, fillOpacity: 0.25 }));
      else if (pts.length === 2) add(L.polyline(pts, { color: editing.color, weight: 3 }));
      pts.forEach((p, i) => {
        const m = L.marker(p, {
          draggable: true,
          icon: L.divIcon({
            className: "",
            iconSize: [14, 14],
            iconAnchor: [7, 7],
            html: `<div style="width:14px;height:14px;border-radius:9999px;background:#fff;border:3px solid ${editing.color};box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
          }),
        });
        m.on("dragend", () => {
          const cur = editRef.current;
          if (!cur) return;
          const ll = m.getLatLng();
          const next = [...cur.points];
          next[i] = [round6(ll.lat), round6(ll.lng)];
          onEditing({ ...cur, points: next });
        });
        add(m);
      });
    }

    // Frame all areas once on first load.
    if (!fitted.current && zones.some((z) => z.polygon.length >= 3)) {
      const all = zones.flatMap((z) => z.polygon);
      map.fitBounds(L.latLngBounds(all), { padding: [30, 30] });
      fitted.current = true;
    }
    map.getContainer().style.cursor = editing ? "crosshair" : "";
  }, [L, zones, editing, onEditing]);

  const jump = (p: PlaceValue) => {
    if (p.lat == null || p.lng == null || !mapRef.current) return;
    mapRef.current.setView([p.lat, p.lng], 13);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="absolute left-14 right-3 top-3 z-[500] max-w-sm">
        <AddressAutocomplete
          label=""
          icon={MapPin}
          value={search}
          placeholder="Find a place on the map…"
          onChange={setSearch}
          onSelect={(p) => {
            setSearch(p.address);
            jump(p);
          }}
        />
      </div>
      {error ? (
        <div className="flex h-[440px] items-center justify-center text-sm text-gray-400">Map could not load.</div>
      ) : (
        <div ref={el} className="h-[440px] w-full" />
      )}
      {editing && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-[500] -translate-x-1/2 rounded-full bg-ink-950/90 px-3 py-1.5 text-xs font-semibold text-white">
          Drawing “{editing.name || "new area"}” — click to add corners
        </div>
      )}
      <style>{`.bf-zone-label{background:rgba(255,255,255,.9);border:0;box-shadow:0 1px 3px rgba(0,0,0,.2);font:600 11px/1.2 system-ui,sans-serif;color:#0f172a;padding:2px 6px;border-radius:6px}.bf-zone-label:before{display:none}`}</style>
    </div>
  );
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Price a real journey exactly as the booking form would (via /api/quote). */
function JourneyTester() {
  const [from, setFrom] = useState<PlaceValue>({ address: "", lat: null, lng: null });
  const [to, setTo] = useState<PlaceValue>({ address: "", lat: null, lng: null });
  const [via, setVia] = useState<PlaceValue>({ address: "", lat: null, lng: null });
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ name: string; total: number; fixed?: string; detour?: number; detourCost?: number }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const ready = from.lat != null && to.lat != null;
  const run = async () => {
    if (!ready) return;
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const r = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site: "main",
          outbound: {
            pickup_lat: from.lat,
            pickup_lng: from.lng,
            dropoff_lat: to.lat,
            dropoff_lng: to.lng,
            via_points: via.lat != null ? [{ lat: via.lat, lng: via.lng }] : [],
            route_text: `${from.address} ${via.address} ${to.address}`,
          },
        }),
      });
      const d = await r.json();
      if (!d?.ok) throw new Error(d?.error);
      setRes(
        (d.quotes as { name: string; fare: { total: number; fixed_route?: string; detour_miles?: number; detour_cost?: number } }[]).map((q) => ({
          name: q.name,
          total: q.fare.total,
          fixed: q.fare.fixed_route,
          detour: q.fare.detour_miles,
          detourCost: q.fare.detour_cost,
        }))
      );
    } catch {
      setErr("Could not price that journey — check both addresses were picked from the list.");
    }
    setBusy(false);
  };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="mb-1 flex items-center gap-2 font-display font-bold text-ink-950">
        <Calculator className="h-4 w-4 text-brand-600" /> Test a journey
      </p>
      <p className="mb-3 text-xs text-gray-500">Prices a real trip exactly like the booking form (vehicle types that are switched on).</p>
      <div className="grid gap-3 md:grid-cols-3">
        <AddressAutocomplete label="From" icon={MapPin} value={from.address} onChange={(a) => setFrom({ address: a, lat: null, lng: null })} onSelect={setFrom} />
        <AddressAutocomplete
          label="Stop (optional)"
          icon={Navigation}
          iconClass="text-gray-400"
          value={via.address}
          onChange={(a) => setVia({ address: a, lat: null, lng: null })}
          onSelect={setVia}
        />
        <AddressAutocomplete label="To" icon={Navigation} value={to.address} onChange={(a) => setTo({ address: a, lat: null, lng: null })} onSelect={setTo} />
      </div>
      <button
        onClick={run}
        disabled={!ready || busy}
        className="mt-3 flex items-center gap-1.5 rounded-lg bg-ink-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />} Price it
      </button>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      {res && (
        <ul className="mt-3 divide-y divide-gray-50 rounded-xl border border-gray-100">
          {res.map((q) => (
            <li key={q.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="font-medium text-ink-950">{q.name}</span>
              <span className="text-right">
                <span className="font-display font-bold text-ink-950">{money(q.total)}</span>
                <span className={cn("block text-[11px]", q.fixed ? "text-green-700" : "text-gray-400")}>
                  {q.fixed
                    ? `Fixed: ${q.fixed}${q.detour ? ` + ${q.detour} extra mi (${money(q.detourCost ?? 0)})` : ""}`
                    : "Per-mile pricing"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
