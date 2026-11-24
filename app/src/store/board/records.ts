// Gramps records in Gramps' own internal JSON form (object_to_dict), the
// form the Evidence Board stages changes in and saves through
// POST /api/transactions/ (see EVIDENCE_BOARD_PLAN.md).
//
// Why this form and not the REST form every other part of the app reads:
// the transactions endpoint stores records exactly as sent and refuses a
// batch whose `old` differs from what's stored, comparing field by field.
// POST /api/<type>/query/ returns exactly that form when `select` lists
// every field (checked on 765 records of all nine types, 2026-11-24);
// with no `select` it returns only the flat columns. The REST GET form
// (type names as words, no `_class`, extra computed keys) would need a
// conversion that has to match Gramps exactly; this needs none.
//
// The field lists, blank records and type codes come from
// data/grampsRecordShapes.json, generated from Gramps by
// scripts/export-gramps-record-shapes.py.
import shapes from "../../data/grampsRecordShapes.json";
import { getToken } from "../../auth/auth";
import { API_BASE } from "../../config";
import { parseErrorMessage } from "../api";
import { apiFetch } from "../apiFetch";

export type GrampsClass = "Person" | "Family" | "Event" | "Place" | "Source" | "Citation" | "Repository" | "Media" | "Note";
export const GRAMPS_CLASSES: GrampsClass[] = ["Person", "Family", "Event", "Place", "Source", "Citation", "Repository", "Media", "Note"];

/** A record as Gramps stores it. Every field is present; nested objects
 * carry their own `_class`. Typed loosely: the board only ever touches a
 * handful of fields, through links.ts. */
export interface GrampsRecord {
  _class: GrampsClass;
  handle: string;
  gramps_id: string;
  [field: string]: unknown;
}

/** A Gramps type value, e.g. an event's type or a reference's role. */
export interface GrampsTypeValue {
  _class: string;
  value: number;
  string: string;
}

/** Handle -> record. Handles are unique across record types in practice
 * (random 32-hex-digit strings), so one map holds a whole board. */
export type Records = Record<string, GrampsRecord>;

const FIELDS = shapes.fields as Record<GrampsClass, string[]>;
const BLANKS = shapes.blanks as Record<string, Record<string, unknown>>;
const TYPES = shapes.types as Record<string, Record<string, number>>;

export const GRAMPS_VERSION_OF_SHAPES: string = shapes.gramps_version;
export const GENDER = shapes.person_gender as { FEMALE: number; MALE: number; UNKNOWN: number };

/** API namespace of each record type (`/api/<namespace>/...`). */
export const NAMESPACE: Record<GrampsClass, string> = {
  Person: "people",
  Family: "families",
  Event: "events",
  Place: "places",
  Source: "sources",
  Citation: "citations",
  Repository: "repositories",
  Media: "media",
  Note: "notes",
};

/** Every stored field of a record type: the `select` that makes /query/
 * return the internal form. */
export function recordFields(cls: GrampsClass): string[] {
  return FIELDS[cls];
}

/** A fresh copy of Gramps' empty object of class `cls` (top-level or
 * nested, e.g. "EventRef"), with `fields` laid over it. */
export function blank<T extends Record<string, unknown> = Record<string, unknown>>(cls: string, fields: Record<string, unknown> = {}): T {
  const base = BLANKS[cls];
  if (!base) throw new Error(`No blank shape for ${cls}; regenerate data/grampsRecordShapes.json`);
  return { ...structuredClone(base), ...fields } as T;
}

/** The integer code of a named Gramps type value, e.g.
 * typeCode("EventType", "BIRTH") === 12. */
export function typeCode(typeClass: string, name: string): number {
  const code = TYPES[typeClass]?.[name];
  if (code === undefined) throw new Error(`Unknown Gramps type ${typeClass}.${name}`);
  return code;
}

/** A type value: a built-in one by name, or a custom one by its text
 * (custom types are stored as CUSTOM plus the text, as Gramps does). */
export function grampsType(typeClass: string, name: string): GrampsTypeValue;
export function grampsType(typeClass: string, name: "CUSTOM", custom: string): GrampsTypeValue;
export function grampsType(typeClass: string, name: string, custom = ""): GrampsTypeValue {
  return { _class: typeClass, value: typeCode(typeClass, name), string: name === "CUSTOM" ? custom : "" };
}

/** Is `t` the built-in type `name` of its class? */
export function isType(t: unknown, typeClass: string, name: string): boolean {
  return !!t && typeof t === "object" && (t as GrampsTypeValue).value === typeCode(typeClass, name);
}

const QUERY_CHUNK = 200;

/** Loads records of one type by handle, in Gramps' internal form. Handles
 * that don't exist (or that the user can't see) are simply missing from
 * the result. */
export async function loadRecords(cls: GrampsClass, handles: string[]): Promise<Records> {
  const out: Records = {};
  const unique = [...new Set(handles)];
  for (let i = 0; i < unique.length; i += QUERY_CHUNK) {
    const chunk = unique.slice(i, i + QUERY_CHUNK);
    const res = await apiFetch(`${API_BASE}/api/${NAMESPACE[cls]}/query/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await getToken()}` },
      body: JSON.stringify({
        select: recordFields(cls),
        where_expr: `handle in ${JSON.stringify(chunk)}`,
        limit: chunk.length,
      }),
    });
    if (!res.ok) throw new Error(await parseErrorMessage(res));
    const { items } = (await res.json()) as { items: Record<string, unknown>[] };
    for (const item of items) {
      const record = { _class: cls, ...item } as GrampsRecord;
      out[record.handle] = record;
    }
  }
  return out;
}
