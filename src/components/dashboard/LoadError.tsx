"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Shown when a list query fails.
 *
 * Without this, a broken query renders as an empty list — which reads as "all my
 * bookings have been deleted" and causes real panic. The whole point of this
 * banner is to say, loudly, that the DATA IS FINE and only the fetch broke.
 */
export default function LoadError({
  what,
  detail,
  onRetry,
}: {
  /** Plural noun for what failed to load, e.g. "bookings", "customers", "jobs". */
  what: string;
  /** Raw error from Supabase — technical, but it is what makes the fix findable. */
  detail?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-red-900">Could not load {what}</p>
        <p className="mt-0.5 text-sm text-red-800">
          Nothing has been deleted — your {what} are safe in the database. This is a problem fetching
          them, so try again, and if it keeps happening send this message to your developer:
        </p>
        {detail && (
          <p className="mt-1.5 break-words rounded-lg bg-red-100 px-2 py-1 font-mono text-xs text-red-700">
            {detail}
          </p>
        )}
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        )}
      </div>
    </div>
  );
}
