/** Server-side helper: call a Supabase RPC via the REST API (Node → Supabase). */
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function callRpc<T = unknown>(
  fn: string,
  params: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
    },
    body: JSON.stringify(params),
    cache: "no-store",
  });
  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * Like callRpc, but sends the newer optional parameters (`newer`) only if the
 * database already has them. Until a migration that adds them has been run,
 * PostgREST answers "function not found" (PGRST202) — then the call is simply
 * repeated without them, so a deploy never breaks pricing or booking.
 */
export async function callRpcCompat<T = unknown>(
  fn: string,
  params: Record<string, unknown>,
  newer: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const extra = Object.fromEntries(Object.entries(newer).filter(([, v]) => v !== undefined && v !== null));
  if (Object.keys(extra).length === 0) return callRpc<T>(fn, params);
  const first = await callRpc<T>(fn, { ...params, ...extra });
  const code = (first.data as { code?: string } | null)?.code;
  if (!first.ok && (code === "PGRST202" || first.status === 404)) return callRpc<T>(fn, params);
  return first;
}
