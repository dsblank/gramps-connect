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
import { GOQL_VOCABULARIES, goqlNamespaceForEndpoint, resolveGoqlPath, splitGoqlPick, type FieldNode } from "./goqlCompletion";
import { nameSortKeysAt } from "./nameDisplay";
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

/** Where each GOQL collection's handles are stored on the record, and the
 * table they're in -- GOQL's own `_COLLECTIONS` (query.py). `child_refs`
 * (a person's own ChildRef in each parent family) lives in those families,
 * found through parent_family_list. `backlinks` isn't here: other records'
 * references to this one aren't stored on it. */
const COLLECTION_LIST: Record<string, { field: string; table: string }> = {
  events: { field: "event_ref_list", table: "event" },
  citations: { field: "citation_list", table: "citation" },
  media: { field: "media_list", table: "media" },
  notes: { field: "note_list", table: "note" },
  tags: { field: "tag_list", table: "tag" },
  families: { field: "family_list", table: "family" },
  parent_families: { field: "parent_family_list", table: "family" },
  child_refs: { field: "parent_family_list", table: "family" },
  children: { field: "child_ref_list", table: "person" },
  associations: { field: "person_ref_list", table: "person" },
  enclosing_places: { field: "placeref_list", table: "place" },
  repositories: { field: "reporef_list", table: "repository" },
};

const COUNT_CALL_RE = /^(?:len|count)\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,([\s\S]*))?\)$/;
// len([... for x in rel ...]), or len(distinct([...])).
const COUNT_COMPREHENSION_RE =
  /^len\(\s*(?:distinct\(\s*)?\[([\s\S]*)\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)\b([\s\S]*)\]\s*(?:\)\s*)?\)$/;

/** How to keep `expr`'s column fresh in `namespace` ("Person", ...): the
 * links it reads through, and whether it also reads something no cached
 * handle can track -- another record's references to this one
 * (`backlinks`), or, inside a collection's condition, a further link or
 * collection of those records (`count(events, place.title == "x")`: the
 * events are watched, their places aren't). An untracked column is only
 * brought up to date when its own row is refetched. */
export function expressionDependencies(namespace: string, expr: string): { links: LinkDependency[]; untracked: boolean } {
  const vocab = GOQL_VOCABULARIES[namespace];
  if (!vocab) return { links: [], untracked: false };
  const text = withoutStrings(expr).trim();

  // A count over one of this record's collections.
  const call = COUNT_CALL_RE.exec(text);
  const comprehension = call ? null : COUNT_COMPREHENSION_RE.exec(text);
  const collection = call?.[1] ?? comprehension?.[3];
  if (collection && collection in vocab.collections) {
    const list = COLLECTION_LIST[collection];
    if (!list) return { links: [], untracked: true }; // backlinks
    const condition = call ? call[2] ?? "" : `${comprehension![1]} ${comprehension![4]}`;
    // No condition: it counts the refs stored on this record itself.
    if (!condition.trim()) return { links: [], untracked: false };
    const target = vocab.collections[collection];
    const targetVocab = target ? GOQL_VOCABULARIES[target] : undefined;
    const bound = comprehension?.[2];
    let deeper = false;
    for (const match of condition.matchAll(CHAIN_RE)) {
      let segments = match[0].split(".").map((seg) => seg.replace(/\[[0-9]+\]/g, ""));
      if (bound && segments[0] === bound) segments = segments.slice(1);
      if (segments.length === 0 || !targetVocab) continue; // child_refs: ChildRef fields only
      // A bare link (`[f.father for f in ...]`) is the handle stored on the
      // record itself; only reading on through it (`f.father.surname`) or
      // into a collection reaches other records.
      if (segments[0] in targetVocab.relationships && segments.length > 1) deeper = true;
      if (segments[0] in targetVocab.collections) deeper = true;
    }
    return { links: [{ select: list.field, table: list.table }], untracked: deeper };
  }

  // One entry of a list comprehension (`[f for f in parent_families if
  // ...][0].mother.primary_name`).
  const picked = pickDependencies(namespace, text, expr.trim());
  if (picked) return picked;

  // A path, possibly through links.
  const links = new Map<string, LinkDependency>();
  let untracked = false;
  for (const match of text.matchAll(CHAIN_RE)) {
    const raw = match[0].split(".");
    if (raw[0].replace(/\[[0-9]+\]/g, "") in vocab.collections && !raw[0].includes("[")) {
      untracked = true; // a collection used some other way
      continue;
    }
    if (followLinks(namespace, [], raw, links)) untracked = true;
  }
  return { links: [...links.values()], untracked };
}

const PICK_RE = new RegExp(
  "^\\[\\s*([A-Za-z_][A-Za-z0-9_.\\[\\]]*?)\\s+for\\s+([A-Za-z_][A-Za-z0-9_]*)\\s+in\\s+([A-Za-z_][A-Za-z0-9_]*)\\b([\\s\\S]*)\\]$",
);

/** expressionDependencies for one entry of a list comprehension, or null if
 * `text` isn't one. From a list on the record itself (`attribute_list`),
 * nothing outside the row is read, unless the path after it crosses a
 * link; from a collection (`parent_families`), its list is watched, then
 * the path on from the chosen record is followed like any other. `text` is
 * `original` with its strings blanked out (same length), for reading the
 * structure; the hidden select keeps `original`'s strings. */
function pickDependencies(
  namespace: string,
  text: string,
  original: string,
): { links: LinkDependency[]; untracked: boolean } | null {
  const pick = splitGoqlPick(text);
  if (!pick) return null;
  const m = PICK_RE.exec(pick.comprehension);
  if (!m) return { links: [], untracked: true };
  const [, collected, bound, source, condition] = m;
  const vocab = GOQL_VOCABULARIES[namespace];
  const after = [...collected.split(".").slice(1), ...pick.rest.split(".").filter(Boolean)];
  const target = vocab.collections[source];
  const list = COLLECTION_LIST[source];
  if (!(source in vocab.collections)) {
    // A list on the record: the entry's own fields, read from this row.
    return { links: [], untracked: false };
  }
  if (!target || !list) return { links: [], untracked: true }; // backlinks, child_refs
  const links = new Map<string, LinkDependency>([[list.field, { select: list.field, table: list.table }]]);
  // A link inside the condition reads records nothing here watches.
  let untracked = false;
  const targetVocab = GOQL_VOCABULARIES[target];
  for (const chain of condition.matchAll(CHAIN_RE)) {
    const segments = chain[0].split(".").map((seg) => seg.replace(/\[[0-9]+\]/g, ""));
    if (segments[0] !== bound || segments.length < 2 || !targetVocab) continue;
    if (segments[1] in targetVocab.relationships || segments[1] in targetVocab.collections) untracked = true;
  }
  // The chosen record, by the same comprehension with no projection. The
  // condition sits just before the comprehension's closing `]`.
  const end = pick.comprehension.length - 1;
  const originalCondition = original.slice(end - condition.length, end);
  const base = `[${bound} for ${bound} in ${source}${originalCondition}][${pick.index}]`;
  if (followLinks(target, [base], after, links)) untracked = true;
  return { links: [...links.values()], untracked };
}

/** Add to `links` each link the path `raw` (segments, `[n]` kept) crosses
 * from `namespace`, written after `prefix` in each hidden select. True if
 * it crosses one no cached handle can track. */
function followLinks(namespace: string, prefix: string[], raw: string[], links: Map<string, LinkDependency>): boolean {
  const segments = raw.map((seg) => seg.replace(/\[[0-9]+\]/g, ""));
  const indexed = raw.map((seg) => seg.includes("["));
  let ns = namespace;
  for (let i = 0; i < segments.length; i += 1) {
    const nsVocab = GOQL_VOCABULARIES[ns];
    // One entry of a collection (`parent_families[0].father`) is a link
    // too; the whole list is watched, so any of its records changing
    // refreshes the row.
    const collectionTarget = indexed[i] ? nsVocab?.collections[segments[i]] : null;
    const collectionList = collectionTarget ? COLLECTION_LIST[segments[i]] : undefined;
    if (collectionTarget && collectionList) {
      const select = [...prefix, ...raw.slice(0, i), collectionList.field].join(".");
      links.set(select, { select, table: collectionList.table });
      ns = collectionTarget;
      continue;
    }
    const linkTarget = nsVocab?.relationships[segments[i]];
    if (!linkTarget) break;
    const field = LINK_HANDLE_FIELD[`${ns}.${segments[i]}`];
    if (!field) return true;
    const select = [...prefix, ...raw.slice(0, i), field].join(".");
    links.set(select, { select, table: linkTarget.toLowerCase() });
    ns = linkTarget;
  }
  return false;
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

/** What sorting by `expr` sorts by, most significant first: the expression
 * itself for a single value or a count, a date's `sortval`, a name's parts
 * (nameSortKeysAt); null for a Gramps type, which is stored as a number
 * whose order isn't its name's (Marriage before Birth), or a whole record. */
export function customSortKeys(namespace: string, expr: string): (() => string[]) | null {
  const text = expr.trim();
  if (!isValuePath(text)) return () => [text]; // len(...)/count(...)
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

/** A path, or one entry of a list comprehension read on like one
 * (`[a.value for a in attribute_list if ...][0]`): something whose value's
 * shape the vocabulary can tell, unlike a count. */
function isValuePath(text: string): boolean {
  return PLAIN_PATH_RE.test(text) || splitGoqlPick(text) !== null;
}

/** Why `expr` can't be a column -- it reaches a whole record, a list or
 * some other structure -- or null when it shows a single value (or the
 * vocabulary can't tell, which the server's own check on Save settles). */
export function structuredValueError(namespace: string, expr: string): string | null {
  const text = expr.trim();
  if (!isValuePath(text)) return null; // len(...)/count(...): a number
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
