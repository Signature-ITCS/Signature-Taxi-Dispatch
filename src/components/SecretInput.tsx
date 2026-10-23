"use client";

import { useRef, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";

/**
 * Write-only fields for API keys and passwords.
 *
 *  - A saved key is never sent back to the browser — not even partly. The page
 *    only knows THAT it is saved, and when.
 *  - What is typed is never kept in React state or in the input's `value`
 *    attribute: the field is uncontrolled and read only at the moment of
 *    saving, then wiped. Browsers and password managers are asked not to store
 *    or suggest it.
 */
export interface SecretStatus {
  set: boolean;
  updated_at: string | null;
}

export function useSecretFields() {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, name: string, on: boolean) => {
    const n = new Set(set);
    if (on) n.add(name);
    else n.delete(name);
    return n;
  };
  return {
    editing,
    removing,
    register: (name: string) => (el: HTMLInputElement | null) => {
      if (el) inputs.current.set(name, el);
      else inputs.current.delete(name);
    },
    edit: (name: string, on: boolean) => setEditing((s) => toggle(s, name, on)),
    remove: (name: string, on: boolean) => setRemoving((s) => toggle(s, name, on)),
    /** The values to send for these fields: typed ones, and "" for removals. Empty fields are left out. */
    collect(names: string[]): Record<string, string> {
      const out: Record<string, string> = {};
      for (const n of names) {
        if (removing.has(n)) out[n] = "";
        else {
          const v = inputs.current.get(n)?.value.trim();
          if (v) out[n] = v;
        }
      }
      return out;
    },
    /** Wipe every field (call after a successful save). */
    clear() {
      for (const el of inputs.current.values()) el.value = "";
      setEditing(new Set());
      setRemoving(new Set());
    },
  };
}

export type SecretFields = ReturnType<typeof useSecretFields>;

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

export function SecretInput({
  label,
  name,
  status,
  fields,
  placeholder,
}: {
  label: string;
  name: string;
  status?: SecretStatus;
  fields: SecretFields;
  placeholder?: string;
}) {
  if (fields.removing.has(name)) {
    return (
      <div className="text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        <div className="mt-1 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
          Will be removed when you save
          <button type="button" onClick={() => fields.remove(name, false)} className="ml-auto font-semibold">
            Undo
          </button>
        </div>
      </div>
    );
  }
  if (status?.set && !fields.editing.has(name)) {
    return (
      <div className="text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        <div className="mt-1 flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
          <KeyRound className="h-4 w-4 text-emerald-600" />
          <span className="text-xs text-gray-600">Saved{status.updated_at ? ` · ${when(status.updated_at)}` : ""} — hidden for security</span>
          <button type="button" onClick={() => fields.edit(name, true)} className="ml-auto text-xs font-semibold text-brand-600">
            Replace
          </button>
          <button type="button" title="Remove" aria-label={`Remove ${label}`} onClick={() => fields.remove(name, true)} className="text-gray-400 hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }
  return (
    <label className="block text-sm">
      <span className="font-medium text-gray-700">{label}</span>
      <input
        ref={fields.register(name)}
        type="password"
        name={`secret-${name}`}
        autoComplete="new-password"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        defaultValue=""
        placeholder={status?.set ? "Paste the new value" : placeholder}
        className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs outline-none focus:border-brand-500"
      />
      {status?.set && (
        <button type="button" onClick={() => fields.edit(name, false)} className="mt-1 text-xs text-gray-500 hover:text-ink-950">
          Keep the saved one
        </button>
      )}
    </label>
  );
}
