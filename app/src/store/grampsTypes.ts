// Type suggestions for the select-or-enter Type fields (GrampsTypeInput.tsx):
// gramps-web-api's GET /api/types/default/ (Gramps' built-in names, per
// type kind -- the same English strings a draft stores and the server
// maps back to a value) and GET /api/types/custom/ (custom types this
// tree's records already use).
//
// Built-ins never change, so they're fetched once per session. Custom
// types grow as people save new ones, so they're refetched at most every
// CUSTOM_MAX_AGE_MS -- each Type field asks again when it mounts.
import { useEffect, useState } from "react";
import { getToken } from "../auth/auth";
import { API_BASE } from "../config";
import { apiFetch } from "./apiFetch";

/** A /api/types/default/ list. */
export type GrampsTypeKind =
  | "place_types" | "event_types" | "note_types" | "repository_types"
  | "attribute_types" | "source_attribute_types";

/** A /api/types/custom/ list: the same names, except attributes, whose
 * custom types are kept per record kind ("person_attribute_types", ...)
 * while their built-ins are one shared "attribute_types" list. */
export type CustomTypeKind =
  | Exclude<GrampsTypeKind, "attribute_types">
  | "person_attribute_types" | "family_attribute_types" | "event_attribute_types" | "media_attribute_types";

type TypeLists = Partial<Record<string, string[]>>;

const CUSTOM_MAX_AGE_MS = 30_000;

let defaults: Promise<TypeLists> | null = null;
let custom: { at: number; lists: Promise<TypeLists> } | null = null;

async function fetchLists(path: string): Promise<TypeLists> {
  const token = await getToken();
  const res = await apiFetch(`${API_BASE}/api/types/${path}/`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`types/${path}: ${res.status}`);
  return (await res.json()) as TypeLists;
}

function load(): { defaults: Promise<TypeLists>; custom: Promise<TypeLists> } {
  if (!defaults) {
    defaults = fetchLists("default").catch(() => {
      defaults = null; // try again next time
      return {};
    });
  }
  if (!custom || Date.now() - custom.at > CUSTOM_MAX_AGE_MS) {
    const entry = {
      at: Date.now(),
      lists: fetchLists("custom").catch(() => {
        if (custom === entry) custom = null;
        return {};
      }),
    };
    custom = entry;
  }
  return { defaults, custom: custom.lists };
}

export interface TypeOptions {
  /** Gramps' built-in names, "Unknown" last. */
  builtIn: string[];
  /** Custom types already used in this tree, not repeating a built-in. */
  custom: string[];
}

const EMPTY: TypeOptions = { builtIn: [], custom: [] };

/** The suggestions for one kind of type; empty until they've loaded (or if
 * they can't be -- the field still takes any text). `customKind` defaults
 * to `kind` (see CustomTypeKind for when it differs). */
export function useGrampsTypeOptions(kind: GrampsTypeKind, customKind: CustomTypeKind = kind as CustomTypeKind): TypeOptions {
  const [options, setOptions] = useState<TypeOptions>(EMPTY);
  useEffect(() => {
    let cancelled = false;
    const { defaults: d, custom: c } = load();
    void Promise.all([d, c]).then(([dl, cl]) => {
      if (cancelled) return;
      const all = dl[kind] ?? [];
      const builtIn = [...all.filter((n) => n !== "Unknown"), ...all.filter((n) => n === "Unknown")];
      const known = new Set(builtIn.map((n) => n.toLowerCase()));
      const customNames = [...new Set(cl[customKind] ?? [])]
        .filter((n) => n.trim() !== "" && !known.has(n.toLowerCase()))
        .sort((a, b) => a.localeCompare(b));
      setOptions({ builtIn, custom: customNames });
    });
    return () => {
      cancelled = true;
    };
  }, [kind, customKind]);
  return options;
}

/** `value` spelled as the matching built-in or existing custom type, when
 * it matches one ignoring case and surrounding space ("county " ->
 * "County"); otherwise unchanged -- a genuinely new custom type. */
export function canonicalTypeName(value: string, options: TypeOptions): string {
  const key = value.trim().toLowerCase();
  if (!key) return value;
  return [...options.builtIn, ...options.custom].find((n) => n.toLowerCase() === key) ?? value;
}

