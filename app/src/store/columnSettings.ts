// Per-list column settings, chosen in the list's Columns dialog
// (ColumnSettingsDialog.tsx): extra columns defined by a GOQL expression,
// plus the order and visibility of every column. Per browser, per tree:
// one localStorage blob keyed by tree id, then view key.
//
// Custom columns are real cache columns: applyColumnSettings() appends them
// to the view's own `columns`, so the local SQLite table, the /query/
// select, live-sync patches and the cache's schema signature all pick them
// up with no special case. Order and visibility are display only (see
// layoutColumns()) and never touch the cache.
import { useSyncExternalStore, type ReactNode } from "react";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { getTreeId } from "../auth/auth";
import { GRAMPS_TYPE_TABLES, type GrampsTypeTable } from "../data/grampsTypeTables";
import { GOQL_VOCABULARIES, goqlNamespaceForEndpoint, resolveGoqlPath, type FieldNode } from "./goqlCompletion";
import { displayNameSortKeys } from "./nameDisplay";
import { formatDisplayDate } from "./placeIndex";
import { STORAGE_KEYS } from "./storageKeys";
import { displayName, formatChange, formatChangeTitle, SORT_ROW_LIMIT, type ColumnConfig, type ViewConfig } from "./views";

const STORAGE_KEY = STORAGE_KEYS.columnLayouts;

export interface CustomColumn {
  /** Stable cache column key (`goql_<...>`), kept when the expression or
   * title is edited. */
  id: string;
  /** A GOQL select expression: a path (`birth.place.title`) or a count
   * (`len(citations)`). */
  expr: string;
  /** Header text; the expression itself when absent. */
  title?: string;
  /** Clicking the header sorts by it -- while the list has at most
   * SORT_ROW_LIMIT rows (see customSortKeys). */
  sortable?: boolean;
}

export { SORT_ROW_LIMIT };

export interface ColumnLayout {
  custom: CustomColumn[];
  /** Column keys in display order. Keys not listed (a built-in column
   * added in a later version) go after the listed ones, in their own
   * order. */
  order: string[];
  /** Column keys not shown. */
  hidden: string[];
}

type LayoutsByTree = Record<string, Record<string, ColumnLayout>>;

const EMPTY_LAYOUT: ColumnLayout = { custom: [], order: [], hidden: [] };

function readAll(): LayoutsByTree {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LayoutsByTree) : {};
  } catch {
    return {};
  }
}

function treeKey(): string {
  return getTreeId() ?? "";
}

export function getColumnLayout(viewKey: string): ColumnLayout {
  const layout = readAll()[treeKey()]?.[viewKey];
  return layout ? { ...EMPTY_LAYOUT, ...layout } : EMPTY_LAYOUT;
}

/** Saves `viewKey`'s layout for the current tree; null resets it to the
 * built-in columns. Callers then call ViewStore.applyColumnChange() so the
 * list follows. */
export function setColumnLayout(viewKey: string, layout: ColumnLayout | null): void {
  const all = readAll();
  const tree = treeKey();
  const views = { ...all[tree] };
  if (layout) views[viewKey] = layout;
  else delete views[viewKey];
  if (Object.keys(views).length > 0) all[tree] = views;
  else delete all[tree];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage blocked: the change still applies for this session.
  }
  sessionLayouts.set(`${tree}\n${viewKey}`, layout ?? EMPTY_LAYOUT);
  bump();
}

// Kept per session so a blocked localStorage still lets the dialog work.
const sessionLayouts = new Map<string, ColumnLayout>();

function currentLayout(viewKey: string): ColumnLayout {
  return sessionLayouts.get(`${treeKey()}\n${viewKey}`) ?? getColumnLayout(viewKey);
}

export function isDefaultLayout(layout: ColumnLayout): boolean {
  return layout.custom.length === 0 && layout.order.length === 0 && layout.hidden.length === 0;
}

/** A fresh custom column key, unique enough to never meet another. */
export function newCustomColumnId(): string {
  return `goql_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

// --- change notification ----------------------------------------------------

let version = 0;
const listeners = new Set<() => void>();

function bump(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders on any layout change or applied column change. */
export function useColumnSettingsVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

// --- broken expressions -----------------------------------------------------

/** Custom columns the server rejected this session, by view key then id,
 * with its message: left out of the list (so the rest still loads) and
 * shown as an error in the dialog. Cleared when the dialog saves. */
const broken = new Map<string, Map<string, string>>();

export function markBroken(viewKey: string, id: string, message: string): void {
  const map = broken.get(viewKey) ?? new Map<string, string>();
  map.set(id, message);
  broken.set(viewKey, map);
}

export function brokenMessage(viewKey: string, id: string): string | undefined {
  return broken.get(viewKey)?.get(id);
}

export function clearBroken(viewKey: string): void {
  broken.delete(viewKey);
}

// --- applying to a view -----------------------------------------------------

/** Each view's columns and dependsOn as views.ts defines them, captured
 * before the first custom column is added. */
const builtins = new WeakMap<ViewConfig, { columns: ColumnConfig[]; dependsOn: ViewConfig["dependsOn"] }>();

function captureBuiltins(view: ViewConfig) {
  let entry = builtins.get(view);
  if (!entry) {
    entry = { columns: view.columns.slice(), dependsOn: view.dependsOn };
    builtins.set(view, entry);
  }
  return entry;
}

export function builtinColumns(view: ViewConfig): ColumnConfig[] {
  return captureBuiltins(view).columns;
}

// --- keeping custom columns fresh -------------------------------------------
//
// A custom column that reads through a link (`birth.place.title`) copies
// data from another record, so editing that record must refresh the rows
// that copied it -- the same job ViewConfig.dependsOn does for built-in
// columns like Events' place title. For each link an expression crosses,
// a hidden column caches the linked record's handle(s), and the view gets
// a dependsOn entry on the linked table via that column.
//
// The handle comes from the field the link is stored in, not from
// `<link>.handle`: selecting `<link>.handle` fails on PostgreSQL (GOQL
// 0.5.13 leaves `ORDER BY handle` ambiguous against the subquery's own
// `handle` column).

/** Where each GOQL relationship's target handle is stored on its source
 * record. A `_list` field holds a list of refs (`{ref: handle}`); a
 * person's birth/death event is one of its event refs, so all of them are
 * watched. */
const LINK_HANDLE_FIELD: Record<string, string> = {
  "Person.birth": "event_ref_list",
  "Person.death": "event_ref_list",
  "Event.place": "place",
  "Family.father": "father_handle",
  "Family.mother": "mother_handle",
  "Citation.source": "source_handle",
  "Place.enclosed_by": "placeref_list",
};

/** One link an expression crosses: the select that reads the linked
 * handle(s) and the table those handles are in. */
export interface LinkDependency {
  select: string;
  table: string;
}

/** The parts of an expression that aren't inside a string literal. */
function withoutStrings(expr: string): string {
  return expr.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => " ".repeat(m.length));
}

const CHAIN_RE = /(?<![A-Za-z0-9_.])[A-Za-z_][A-Za-z0-9_]*(?:\[[0-9]+\])*(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[[0-9]+\])*)*/g;

/** How to keep `expr`'s column fresh in `namespace` ("Person", ...):
 * the links it reads through, and whether it also reads something no
 * cached handle can track -- another record's references to this one
 * (`backlinks`), or a collection's records (`count(events, ...)`), which
 * then only update when this record itself changes or the list reloads. */
export function expressionDependencies(namespace: string, expr: string): { links: LinkDependency[]; untracked: boolean } {
  const vocab = GOQL_VOCABULARIES[namespace];
  if (!vocab) return { links: [], untracked: false };
  const links = new Map<string, LinkDependency>();
  let untracked = false;
  const text = withoutStrings(expr);
  const ownListCount = /^\s*len\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*$/.exec(text)?.[1];
  for (const match of text.matchAll(CHAIN_RE)) {
    const segments = match[0].split(".").map((s) => s.replace(/\[[0-9]+\]/g, ""));
    if (segments[0] in vocab.collections) {
      // len(<collection>) of one of this record's own lists counts refs
      // stored on this record; anything else reads other records.
      if (segments[0] === "backlinks" || segments[0] !== ownListCount) untracked = true;
      continue;
    }
    let ns = namespace;
    for (let i = 0; i < segments.length; i += 1) {
      const target = GOQL_VOCABULARIES[ns]?.relationships[segments[i]];
      if (!target) break;
      const field = LINK_HANDLE_FIELD[`${ns}.${segments[i]}`];
      if (!field) {
        untracked = true;
        break;
      }
      const select = [...segments.slice(0, i), field].join(".");
      links.set(select, { select, table: target.toLowerCase() });
      ns = target;
    }
  }
  return { links: [...links.values()], untracked };
}

/** Handle(s) out of a link field's value: a handle string, or a list of
 * refs, comma-joined (what ViewStore.refreshDependents matches against). */
function toLinkHandles(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (!Array.isArray(value)) return null;
  const handles = value
    .map((v) => (typeof v === "string" ? v : (v as { ref?: unknown } | null)?.ref))
    .filter((h): h is string => typeof h === "string" && h !== "");
  return handles.length > 0 ? handles.join(",") : null;
}

function dependencyColumns(view: ViewConfig, column: CustomColumn): { columns: ColumnConfig[]; dependsOn: { table: string; via: string }[] } {
  const namespace = goqlNamespaceForEndpoint(view.endpoint);
  if (!namespace) return { columns: [], dependsOn: [] };
  const { links } = expressionDependencies(namespace, column.expr);
  const columns = links.map((link, i): ColumnConfig => ({
    key: `${column.id}_d${i}`,
    label: link.select,
    select: { goql: link.select },
    sqlType: "TEXT",
    hidden: true,
    toSql: toLinkHandles,
  }));
  return { columns, dependsOn: links.map((link, i) => ({ table: link.table, via: columns[i].key })) };
}

/** A record's last-changed time (`change`, `birth.place.change`): shown
 * like the built-in "Last changed" column, relative with the exact time on
 * hover. */
function isChangeTime(expr: string): boolean {
  return /(^|\.)change$/.test(expr.trim());
}

/** A name's sort keys under `path` (`father.primary_name`): its parts in
 * the order the tree's name format writes them, as the People list's Name
 * column sorts (nameDisplay.ts's nameSortKeys) -- read on each sort, so a
 * name format change applies. The surname is the first in its list, which
 * is the primary one for nearly everyone. */
function nameSortKeysAt(path: string): string[] {
  return displayNameSortKeys().map((key) =>
    key === "surname"
      ? `${path}.surname_list[0].surname`
      : key === "given_name"
        ? `${path}.first_name`
        : key.replace(/^primary_name\./, `${path}.`),
  );
}

/** What sorting by `expr` sorts by, most significant first: the expression
 * itself for a single value or a count, a date's `sortval`, a name's parts
 * (nameSortKeysAt); null for a Gramps type, which is stored as a number
 * whose order isn't its name's (Marriage before Birth), or a whole record. */
export function customSortKeys(namespace: string, expr: string): (() => string[]) | null {
  const text = expr.trim();
  if (!PLAIN_PATH_RE.test(text)) return () => [text]; // len(...)/count(...)
  const resolved = resolveGoqlPath(namespace, text);
  if (!resolved) return () => [text]; // unknown to the vocabulary: the server decides
  if (resolved.kind === "record") return null;
  const fields = resolved.node.fields;
  if (!fields) return () => [text];
  if ("dateval" in fields && "sortval" in fields) return () => [`${text}.sortval`];
  if ("first_name" in fields && "surname_list" in fields) return () => nameSortKeysAt(text);
  return null;
}

/** Every key a column sorts by (sortKeys, else sortBy). */
export function columnSortKeys(column: ColumnConfig): string[] {
  return column.sortKeys?.() ?? (column.sortBy ? [column.sortBy] : []);
}

/** A custom column's config. A sortable one sorts by its sort keys
 * (customSortKeys). ViewStore's rank query compares against the row's
 * value for each key: this column's own value when the key is its
 * expression (`orderPath`), else read from inside it (a date's `sortval`,
 * a name's parts). */
export function customColumnConfig(column: CustomColumn, namespace = ""): ColumnConfig {
  const changeTime = isChangeTime(column.expr);
  const sortKeys = column.sortable ? customSortKeys(namespace, column.expr) : null;
  const keys = sortKeys?.() ?? [];
  const expr = column.expr.trim();
  const sorting: Partial<ColumnConfig> = !sortKeys
    ? {}
    : keys.length === 1
      ? { sortBy: keys[0], sortLimit: SORT_ROW_LIMIT, ...(keys[0] === expr ? { orderPath: expr } : {}) }
      : { sortKeys, sortLimit: SORT_ROW_LIMIT };
  return {
    key: column.id,
    label: column.title?.trim() || column.expr,
    literalLabel: true,
    select: { goql: column.expr },
    sqlType: "TEXT",
    toSql: (value) => (value === undefined || value === null ? null : JSON.stringify(value)),
    toDisplay: changeTime ? (stored) => formatChange(parseStored(stored)) : formatGoqlValue,
    toTitle: changeTime ? (stored) => formatChangeTitle(parseStored(stored)) : undefined,
    ...sorting,
  };
}

/** Whether going from layout `before` to `after` changes what `view`
 * caches (so saving refetches the list) -- for the dialog's warning. */
export function layoutChangesCache(view: ViewConfig, before: ColumnLayout, after: ColumnLayout | null): boolean {
  const namespace = goqlNamespaceForEndpoint(view.endpoint) ?? "";
  const signature = (layout: ColumnLayout | null) =>
    columnSignature(
      (layout?.custom ?? [])
        .filter((c) => c.expr.trim() && !structuredValueError(namespace, c.expr))
        .map((c) => customColumnConfig(c, namespace)),
    );
  return signature(before) !== signature(after);
}

function columnSignature(columns: ColumnConfig[]): string {
  return JSON.stringify(columns.map((c) => [c.key, c.select]));
}

/** Sets `view.columns` to its built-in columns plus the current tree's
 * custom ones (less any marked broken). True when that changed what's
 * cached -- a column added, removed or given a new expression -- so the
 * list has to be refetched; a title change alone returns false. */
export function applyColumnSettings(view: ViewConfig): boolean {
  const base = captureBuiltins(view);
  const namespace = goqlNamespaceForEndpoint(view.endpoint) ?? "";
  const custom = currentLayout(view.key).custom.filter(
    (c) => c.expr.trim() && !brokenMessage(view.key, c.id) && !structuredValueError(namespace, c.expr),
  );
  const deps = custom.map((c) => dependencyColumns(view, c));
  const next = [
    ...base.columns,
    ...custom.map((c) => customColumnConfig(c, namespace)),
    ...deps.flatMap((d) => d.columns),
  ];
  const changed = columnSignature(next) !== columnSignature(view.columns);
  view.columns = next;
  const dependsOn = [...(base.dependsOn ?? []), ...deps.flatMap((d) => d.dependsOn)];
  view.dependsOn = dependsOn.length > 0 ? dependsOn : undefined;
  bump();
  return changed;
}

/** The custom columns currently applied to `view`. */
export function appliedCustomColumns(view: ViewConfig): ColumnConfig[] {
  const base = new Set(builtinColumns(view));
  return view.columns.filter((c) => !base.has(c) && !c.hidden);
}

/** The columns DataTable renders, in the layout's order and without the
 * ones it hides -- each with its index into the full `view.columns` (where
 * its value sits in a getRows() row). Columns hidden by views.ts itself
 * (cached for other features) never show. Falls back to the first column
 * rather than showing none. */
export function layoutColumns(view: ViewConfig): { column: ColumnConfig; index: number }[] {
  const layout = currentLayout(view.key);
  const all = view.columns.map((column, index) => ({ column, index })).filter(({ column }) => !column.hidden);
  const position = new Map(layout.order.map((key, i) => [key, i]));
  const ordered = all
    .map((entry, i) => ({ entry, rank: position.get(entry.column.key) ?? layout.order.length + i }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ entry }) => entry);
  const hidden = new Set(layout.hidden);
  const shown = ordered.filter(({ column }) => !hidden.has(column.key));
  return shown.length > 0 ? shown : ordered.slice(0, 1);
}

// --- what a column may show -------------------------------------------------
//
// A column shows one value per row: text, a number, a yes/no, or one of the
// few structures with a readable form -- a date, a name, a Gramps type
// (Event type, ...). A whole record, a list, or any other structure would
// only show as raw JSON, so the dialog refuses it.

/** How a path's value shows, from its vocabulary node. */
function nodeShape(node: FieldNode): "value" | "readable" | "structured" {
  const types = Array.isArray(node.type) ? node.type : [node.type];
  if (types.includes("array") || node.items) return "structured";
  const fields = node.fields;
  if (!fields) return "value";
  const keys = Object.keys(fields);
  if ("dateval" in fields && "sortval" in fields) return "readable"; // Date
  if ("first_name" in fields && "surname_list" in fields) return "readable"; // Name
  if (keys.length === 2 && fields.value?.constants && "string" in fields) return "readable"; // a Gramps type
  return "structured";
}

const PLAIN_PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[0-9]+\])*(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[[0-9]+\])*)*$/;

/** Why `expr` can't be a column -- it reaches a whole record, a list or
 * some other structure -- or null when it shows a single value (or the
 * vocabulary can't tell, which the server's own check on Save settles). */
export function structuredValueError(namespace: string, expr: string): string | null {
  const text = expr.trim();
  if (!PLAIN_PATH_RE.test(text)) return null; // len(...)/count(...): a number
  const resolved = resolveGoqlPath(namespace, text);
  if (!resolved) return null;
  if (resolved.kind === "record") {
    return `${text} is a whole record. Pick one of its fields, such as ${text}.gramps_id.`;
  }
  const shape = nodeShape(resolved.node);
  if (shape !== "structured") return null;
  if (resolved.node.items || (Array.isArray(resolved.node.type) ? resolved.node.type : [resolved.node.type]).includes("array")) {
    return `${text} is a list. Pick one item, such as ${text}[0], or count them with len(${text}).`;
  }
  const field = Object.entries(resolved.node.fields ?? {}).find(([, node]) => nodeShape(node) !== "structured")?.[0];
  return field
    ? `${text} holds several values. Pick one, such as ${text}.${field}.`
    : `${text} holds several values. Pick one of its fields.`;
}

// --- display ----------------------------------------------------------------

function parseStored(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A Gramps type value (`{_class: "EventType", value, string}`): its
 * custom string, else its standard name. */
function typeLabel(value: Record<string, unknown>): string | null {
  const table = GRAMPS_TYPE_TABLES[value._class as GrampsTypeTable];
  if (!table) return null;
  if (typeof value.string === "string" && value.string) return value.string;
  const name = Object.entries(table).find(([, v]) => v === value.value)?.[0];
  return name ?? String(value.value ?? "");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "✓" : "";
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (isRecord(value)) {
    if (value._class === "Date") return formatDisplayDate(value as unknown as GrampsDate);
    if (value._class === "Name") return displayName(value);
    const label = typeLabel(value);
    if (label !== null) return label;
  }
  // Never raw JSON (see structuredValueError); only reachable for a path
  // the vocabulary didn't know.
  return "";
}

/** A custom column's cell: dates and names in the tree's display format,
 * Gramps types by name, plain values as they are. */
export function formatGoqlValue(stored: unknown): ReactNode {
  return formatValue(parseStored(stored));
}

/** A built-in column's select, written as the GOQL it sends. */
export function columnExpression(column: ColumnConfig): string {
  const select = column.select;
  if (typeof select === "string") return select;
  if ("goql" in select) return select.goql;
  return select.json_path
    .map((seg, i) => (typeof seg === "number" ? `[${seg}]` : i === 0 ? seg : `.${seg}`))
    .join("");
}
