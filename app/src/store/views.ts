// Per-object-type view definitions -- data, not code. Adding a new object
// type to the sidebar (Event, Place, ...) means adding a new ViewConfig
// here; viewStore.ts's fetch/cache engine is generic over whichever one is
// active, it doesn't know "person" or "family" by name.
//
// Forked from the original Layer 2/3 spike's views.ts (since removed, see
// git history) -- this is the production copy now; see PLAN.md.
import { formatDate, DateFormat, type GrampsDate } from "@gramps-connect/gramps-date";
import { splitAuthorMessage } from "./authoredText";
import iconPerson from "../assets/icons/gramps-person.svg";
import iconFamily from "../assets/icons/gramps-family.svg";
import iconEvent from "../assets/icons/gramps-event.svg";
import iconPlace from "../assets/icons/gramps-place.svg";
import iconRepository from "../assets/icons/gramps-repository.svg";
import iconSource from "../assets/icons/gramps-source.svg";
import iconCitation from "../assets/icons/gramps-citation.svg";
import iconMedia from "../assets/icons/gramps-media.svg";
import iconNotes from "../assets/icons/gramps-notes.svg";
import iconTag from "../assets/icons/gramps-tag.svg";
import iconReports from "../assets/icons/gramps-reports.svg";
import iconChat from "../assets/icons/chat-message.svg";

export interface ColumnConfig {
  /** Both the local SQLite column name and the API response key (the
   * `as` alias for a json_path select entry, sent automatically -- see
   * toSelectEntry in api.ts). */
  key: string;
  label: string;
  /** A plain secondary-column name, or a json_path select entry (without
   * `as` -- that's added automatically from `key`). */
  select: string | { json_path: (string | number)[] };
  sqlType: "TEXT" | "INTEGER";
  /** API response value -> value to store in local SQLite. Default:
   * stored as-is. */
  toSql?: (apiValue: unknown) => string | number | null;
  /** Stored SQLite value -> displayed cell text. Default: String(value),
   * or "" for null/undefined. */
  toDisplay?: (sqlValue: unknown) => string;
}

export interface OrderBy {
  column: string;
  direction: "asc" | "desc";
}

export interface ViewConfig {
  key: string;
  label: string;
  /** Gramps desktop icon (Tango-derived, see assets/icons/ATTRIBUTION.md),
   * used by the icon-rail Sidebar. */
  icon: string;
  endpoint: string;
  /** The underlying object type this view's rows live in, for live-sync
   * routing (registry.ts's getViewStoresForTable) -- defaults to `key`.
   * Set explicitly when more than one view is backed by the same object
   * type (e.g. "media" and "generated" both watch Media changes), so a
   * live-sync notification for that type reaches every view that needs it,
   * not just whichever one happens to share its key. */
  table?: string;
  /** A fixed, non-user-editable where_expr always AND-ed into this view's
   * query (see ViewStore's combinedFilter) -- e.g. the Output view's tag
   * filter. Combined with any user-entered FilterBar search (see
   * `searchable`), so the search box stays scoped to this view's own
   * subset no matter what the user types; live-sync reacts to a change by
   * a full debounced requery rather than incremental patching, since a
   * thin notification can't tell whether a changed row still matches the
   * fixed filter (same reasoning as the ordinary whereExpr!==null guard). */
  baseFilter?: string;
  /** False hides FilterBar's search box entirely -- for a view whose
   * dataset is already fully defined by `baseFilter` and isn't meant to be
   * further refined by the user. Defaults to true. */
  searchable?: boolean;
  /** Sidebar.tsx draws a divider directly above this view's icon -- for a
   * view that isn't another peer object type in the same list (e.g.
   * Output, a fixed-filter window onto other views' own Media rows). */
  sidebarSeparatorBefore?: boolean;
  /** Default sort, used until the user clicks a sortable column header
   * (see ViewStore.setSort). Only ever a plain-column ColumnConfig.select
   * value -- gramps-web-api's order_by validates its column against the
   * object type's flat secondary columns and never resolves a json_path
   * reference for it (unlike select/where), so a column backed by a
   * json_path select (birth_date, place_title, ...) can never appear here
   * or be passed to setSort. */
  orderBy: OrderBy[];
  opfsFilename: string;
  columns: ColumnConfig[];
  wherePlaceholder: string;
}

function formatGrampsDateJson(json: unknown): string {
  if (!json) return "";
  return formatDate(JSON.parse(json as string) as GrampsDate, { format: DateFormat.DAY_SHORT_MONTH_YEAR });
}

function toSqlJson(value: unknown): string | null {
  return value ? JSON.stringify(value) : null;
}

// `change` is a plain Unix mtime (when the record was last edited), not a
// GrampsDate struct -- unrelated to gramps-date, which is about
// genealogical event dates specifically.
function formatChange(unixSeconds: unknown): string {
  const n = unixSeconds as number | null;
  if (!n) return "";
  return new Date(n * 1000).toISOString().slice(0, 10);
}

// A father/mother's primary_name select entry returns the full Name
// struct (first_name, surname_list[0].surname, ...) -- the same shape
// personToRow already parses in schema.ts, applied here instead to a
// stored (not top-level-fetched) name.
function displayName(json: unknown): string {
  if (!json) return "";
  const name = JSON.parse(json as string);
  const surname = name.surname_list?.[0]?.surname ?? "";
  const given = name.first_name ?? "";
  return [given, surname].filter(Boolean).join(" ") || "(unnamed)";
}

export const PERSON_VIEW: ViewConfig = {
  key: "person",
  label: "People",
  icon: iconPerson,
  endpoint: "/api/people/query/",
  orderBy: [{ column: "surname", direction: "asc" }],
  opfsFilename: "app-cache-person.sqlite",
  wherePlaceholder: 'e.g. gender == 1 and surname == "Ancestor"',
  columns: [
    { key: "gramps_id", label: "Gramps ID", select: "gramps_id", sqlType: "TEXT" },
    { key: "surname", label: "Surname", select: "surname", sqlType: "TEXT" },
    { key: "given_name", label: "Given name", select: "given_name", sqlType: "TEXT" },
    {
      key: "birth_date", label: "Birth", select: { json_path: ["birth", "date"] }, sqlType: "TEXT",
      toSql: toSqlJson, toDisplay: formatGrampsDateJson,
    },
    {
      key: "death_date", label: "Death", select: { json_path: ["death", "date"] }, sqlType: "TEXT",
      toSql: toSqlJson, toDisplay: formatGrampsDateJson,
    },
    { key: "change", label: "Last changed", select: "change", sqlType: "INTEGER", toDisplay: formatChange },
  ],
};

export const FAMILY_VIEW: ViewConfig = {
  key: "family",
  label: "Family",
  icon: iconFamily,
  endpoint: "/api/families/query/",
  // Family has no flat "name" column of its own (it's derived from two
  // related Person records) -- gramps_id is the closest thing to a
  // stable, always-present sort key.
  orderBy: [{ column: "gramps_id", direction: "asc" }],
  opfsFilename: "app-cache-family.sqlite",
  wherePlaceholder: 'e.g. gramps_id == "F00001"',
  columns: [
    { key: "gramps_id", label: "Gramps ID", select: "gramps_id", sqlType: "TEXT" },
    {
      key: "father_name", label: "Father", select: { json_path: ["father", "primary_name"] }, sqlType: "TEXT",
      toSql: toSqlJson, toDisplay: displayName,
    },
    {
      key: "mother_name", label: "Mother", select: { json_path: ["mother", "primary_name"] }, sqlType: "TEXT",
      toSql: toSqlJson, toDisplay: displayName,
    },
    { key: "change", label: "Last changed", select: "change", sqlType: "INTEGER", toDisplay: formatChange },
  ],
};

export const EVENT_VIEW: ViewConfig = {
  key: "event",
  label: "Events",
  icon: iconEvent,
  endpoint: "/api/events/query/",
  // Events have no flat "name" column -- gramps_id is the stable default.
  orderBy: [{ column: "gramps_id", direction: "asc" }],
  opfsFilename: "app-cache-event.sqlite",
  wherePlaceholder: 'e.g. type.value == 12',
  columns: [
    { key: "gramps_id", label: "Gramps ID", select: "gramps_id", sqlType: "TEXT" },
    { key: "description", label: "Description", select: "description", sqlType: "TEXT" },
    {
      // Not "birth.date"/"death.date" crossing a relationship -- an Event
      // *is* the thing with the date, so this is a direct (still
      // json_path, since date isn't a flat secondary column) select.
      key: "date", label: "Date", select: { json_path: ["date"] }, sqlType: "TEXT",
      toSql: toSqlJson, toDisplay: formatGrampsDateJson,
    },
    {
      key: "place_title", label: "Place", select: { json_path: ["place", "title"] }, sqlType: "TEXT",
    },
    { key: "change", label: "Last changed", select: "change", sqlType: "INTEGER", toDisplay: formatChange },
  ],
};

export const PLACE_VIEW: ViewConfig = {
  key: "place",
  label: "Places",
  icon: iconPlace,
  endpoint: "/api/places/query/",
  orderBy: [{ column: "title", direction: "asc" }],
  opfsFilename: "app-cache-place.sqlite",
  wherePlaceholder: 'e.g. like(title, "%, TX")',
  columns: [
    { key: "gramps_id", label: "Gramps ID", select: "gramps_id", sqlType: "TEXT" },
    { key: "title", label: "Title", select: "title", sqlType: "TEXT" },
    { key: "lat", label: "Lat", select: "lat", sqlType: "TEXT" },
    { key: "long", label: "Long", select: "long", sqlType: "TEXT" },
    { key: "change", label: "Last changed", select: "change", sqlType: "INTEGER", toDisplay: formatChange },
  ],
};

export const REPOSITORY_VIEW: ViewConfig = {
  key: "repository",
  label: "Repositories",
  icon: iconRepository,
  endpoint: "/api/repositories/query/",
  orderBy: [{ column: "name", direction: "asc" }],
  opfsFilename: "app-cache-repository.sqlite",
  wherePlaceholder: 'e.g. like(name, "%Library%")',
  columns: [
    { key: "gramps_id", label: "Gramps ID", select: "gramps_id", sqlType: "TEXT" },
    { key: "name", label: "Name", select: "name", sqlType: "TEXT" },
    { key: "change", label: "Last changed", select: "change", sqlType: "INTEGER", toDisplay: formatChange },
  ],
};

export const SOURCE_VIEW: ViewConfig = {
  key: "source",
  label: "Sources",
  icon: iconSource,
  endpoint: "/api/sources/query/",
  orderBy: [{ column: "title", direction: "asc" }],
  opfsFilename: "app-cache-source.sqlite",
  wherePlaceholder: 'e.g. like(author, "%Smith%")',
  columns: [
    { key: "gramps_id", label: "Gramps ID", select: "gramps_id", sqlType: "TEXT" },
    { key: "title", label: "Title", select: "title", sqlType: "TEXT" },
    { key: "author", label: "Author", select: "author", sqlType: "TEXT" },
    { key: "change", label: "Last changed", select: "change", sqlType: "INTEGER", toDisplay: formatChange },
  ],
};

// Citation.confidence: CONF_VERY_LOW=0 .. CONF_VERY_HIGH=4, per
// gramps/gen/lib/citation.py.
const CONFIDENCE_LABELS = ["Very Low", "Low", "Normal", "High", "Very High"];
// Exported: reused by related/detailFieldDefinitions.ts to show a Citation's own
// confidence in its detail panel, not just this table column.
export function displayConfidence(value: unknown): string {
  return CONFIDENCE_LABELS[value as number] ?? String(value ?? "");
}

export const CITATION_VIEW: ViewConfig = {
  key: "citation",
  label: "Citations",
  icon: iconCitation,
  endpoint: "/api/citations/query/",
  // Citations have no flat "name" column -- gramps_id is the stable default.
  orderBy: [{ column: "gramps_id", direction: "asc" }],
  opfsFilename: "app-cache-citation.sqlite",
  wherePlaceholder: "e.g. confidence == 4",
  columns: [
    { key: "gramps_id", label: "Gramps ID", select: "gramps_id", sqlType: "TEXT" },
    {
      key: "source_title", label: "Source", select: { json_path: ["source", "title"] }, sqlType: "TEXT",
    },
    { key: "page", label: "Page", select: "page", sqlType: "TEXT" },
    { key: "confidence", label: "Confidence", select: "confidence", sqlType: "INTEGER", toDisplay: displayConfidence },
    { key: "change", label: "Last changed", select: "change", sqlType: "INTEGER", toDisplay: formatChange },
  ],
};

export const MEDIA_VIEW: ViewConfig = {
  key: "media",
  label: "Media",
  icon: iconMedia,
  table: "media",
  endpoint: "/api/media/query/",
  // "desc" is a reserved SQL word (Media.desc) -- the server quotes it
  // automatically wherever it's interpolated (select/where/order_by), see
  // query.py's _quote_column(); nothing special needed client-side.
  orderBy: [{ column: "desc", direction: "asc" }],
  opfsFilename: "app-cache-media.sqlite",
  wherePlaceholder: 'e.g. like(mime, "image/%")',
  columns: [
    { key: "gramps_id", label: "Gramps ID", select: "gramps_id", sqlType: "TEXT" },
    { key: "desc", label: "Description", select: "desc", sqlType: "TEXT" },
    { key: "path", label: "Path", select: "path", sqlType: "TEXT" },
    { key: "mime", label: "MIME type", select: "mime", sqlType: "TEXT" },
    { key: "change", label: "Last changed", select: "change", sqlType: "INTEGER", toDisplay: formatChange },
  ],
};

// Reports & exports are stored as ordinary Media objects, tagged "report"
// or "export" at creation time (see store/jobsPromote.ts) -- this view is
// just MEDIA_VIEW's endpoint/table with a fixed tag filter standing in for
// a dedicated "generated output" object type. Report-vs-export isn't its
// own column: jobsPromote.ts already encodes it as a "Report — "/"Export — "
// prefix on `desc`, which is simpler than a computed/tag-derived column for
// two possible values.
export const GENERATED_VIEW: ViewConfig = {
  key: "generated",
  label: "Output",
  icon: iconReports,
  table: "media",
  endpoint: "/api/media/query/",
  baseFilter: "exists(tags, name == 'report') or exists(tags, name == 'export')",
  // Sidebar.tsx draws a divider above this view -- it's not another
  // user-authored object type like the rest of VIEWS, but a fixed-filter
  // window onto generated reports/exports, so it reads as visually
  // separate from the list above it.
  sidebarSeparatorBefore: true,
  orderBy: [{ column: "change", direction: "desc" }],
  opfsFilename: "app-cache-generated.sqlite",
  wherePlaceholder: 'e.g. like(desc, "%Descendant%")',
  columns: [
    { key: "gramps_id", label: "Gramps ID", select: "gramps_id", sqlType: "TEXT" },
    { key: "desc", label: "Description", select: "desc", sqlType: "TEXT" },
    { key: "mime", label: "MIME type", select: "mime", sqlType: "TEXT" },
    { key: "change", label: "Last changed", select: "change", sqlType: "INTEGER", toDisplay: formatChange },
  ],
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// Gramps Connect messages: standalone Notes (never attached to another
// object's note_list) tagged "team-note" at creation -- same trick
// GENERATED_VIEW uses for report/export, applied to Note instead of Media.
// Completion state is a second tag pair ("todo-open"/"todo-done", see
// notesApi.ts) rather than its own column, for the same reason
// GENERATED_VIEW doesn't have a report-vs-export column: cheaper than
// resolving tag names into the local SQLite cache just for one derived
// field -- confirmed empirically (see authoredText.ts) that a *collection*
// relationship like "tags" can't back a select column at all, only a
// singular one (a Person's "father"/"birth") can. `table: "note"` (key
// differs) puts this store in the same live-sync bucket as NOTE_VIEW, so
// both get notified off one getViewStoresForTable("note") lookup.
export const TEAM_NOTES_VIEW: ViewConfig = {
  // Underscore, not hyphen: viewStore.ts splices view.key directly into
  // raw SQL as the local cache's table name (unquoted -- see e.g.
  // `SELECT ... FROM ${this.view.key}`), and "team-note" there parses as
  // `team MINUS note`. Every other view.key happens to have no hyphen, so
  // this was latent until this view.
  key: "team_note",
  label: "Messages",
  icon: iconChat,
  table: "note",
  endpoint: "/api/notes/query/",
  baseFilter: "exists(tags, name == 'team-note')",
  // No separator of its own -- GENERATED_VIEW's divider already opens this
  // "not an ordinary object type" group in the sidebar; Messages just
  // continues it rather than starting a second one.
  orderBy: [{ column: "change", direction: "desc" }],
  opfsFilename: "app-cache-team-note.sqlite",
  wherePlaceholder: 'e.g. "urgent" in text.string',
  columns: [
    { key: "gramps_id", label: "Gramps ID", select: "gramps_id", sqlType: "TEXT" },
    // "By" and "Message" both read the exact same text.string json_path --
    // sent to the server twice under two aliases (a short string, trivial
    // cost) rather than once, since a ColumnConfig's toDisplay only ever
    // transforms its own single stored value, and each needs a different
    // half of the "author: message" split (see authoredText.ts).
    {
      key: "author", label: "By", select: { json_path: ["text", "string"] }, sqlType: "TEXT",
      toDisplay: (v) => splitAuthorMessage((v as string | null) ?? "").author ?? "",
    },
    {
      key: "text", label: "Message", select: { json_path: ["text", "string"] }, sqlType: "TEXT",
      toDisplay: (v) => truncate(splitAuthorMessage((v as string | null) ?? "").message, 80),
    },
    { key: "change", label: "Last changed", select: "change", sqlType: "INTEGER", toDisplay: formatChange },
  ],
};

export const NOTE_VIEW: ViewConfig = {
  key: "note",
  label: "Notes",
  icon: iconNotes,
  endpoint: "/api/notes/query/",
  // Notes have no flat "name" column -- gramps_id is the stable default.
  orderBy: [{ column: "gramps_id", direction: "asc" }],
  opfsFilename: "app-cache-note.sqlite",
  wherePlaceholder: 'e.g. "TODO" in text.string',
  columns: [
    { key: "gramps_id", label: "Gramps ID", select: "gramps_id", sqlType: "TEXT" },
    {
      // Note.text is a StyledText struct (formatting spans + the plain
      // string); .string is the plain text. Notes can run long, so this
      // is truncated for the table -- the full text still round-trips
      // through local SQLite, only the *display* is cut.
      key: "text", label: "Text", select: { json_path: ["text", "string"] }, sqlType: "TEXT",
      toDisplay: (v) => truncate((v as string | null) ?? "", 80),
    },
    { key: "change", label: "Last changed", select: "change", sqlType: "INTEGER", toDisplay: formatChange },
  ],
};

export const TAG_VIEW: ViewConfig = {
  key: "tag",
  label: "Tags",
  icon: iconTag,
  endpoint: "/api/tags/query/",
  // Tag is the one type with no gramps_id at all (see gramps/gen/lib/tag.py).
  orderBy: [{ column: "name", direction: "asc" }],
  opfsFilename: "app-cache-tag.sqlite",
  wherePlaceholder: 'e.g. like(name, "%todo%")',
  columns: [
    { key: "name", label: "Name", select: "name", sqlType: "TEXT" },
    { key: "color", label: "Color", select: "color", sqlType: "TEXT" },
    { key: "priority", label: "Priority", select: "priority", sqlType: "INTEGER" },
    { key: "change", label: "Last changed", select: "change", sqlType: "INTEGER", toDisplay: formatChange },
  ],
};

export const VIEWS: ViewConfig[] = [
  PERSON_VIEW, FAMILY_VIEW, EVENT_VIEW, PLACE_VIEW, REPOSITORY_VIEW,
  SOURCE_VIEW, CITATION_VIEW, MEDIA_VIEW, NOTE_VIEW, TAG_VIEW, GENERATED_VIEW,
  TEAM_NOTES_VIEW,
];
