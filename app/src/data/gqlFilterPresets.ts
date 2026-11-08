/**
 * GOQL (`where_expr`) equivalents for the classic gramps-core filter rules
 * (gramps/gen/filters/rules/person/*.py, family/*.py). Selection/combination
 * lives in ./../store/goqlFilterCombiner.ts and ./../store/goqlFilterTree.ts;
 * the "Filters" picker (./../components/FilterPickerDialog.tsx) is the UI on
 * top of both.
 *
 * `expr` uses `{placeholder}` tokens for rules that take user input (a
 * date range, a tag name); every other entry is a complete, literal
 * `where_expr` string. `supported: false` entries have no faithful GOQL
 * translation today -- see each one's `notes`.
 */

import type { GrampsTypeTable } from "./grampsTypeTables";

/** GOQL's own registered object types, 1:1 with `gramps_object_query_language
 * .query.py`'s `PERSON`/`FAMILY`/`EVENT`/.../`NOTE` specs and
 * gramps-web-api's matching `/api/<type>/query/` resources -- every Gramps
 * primary object type except Tag (GOQL supports it too, `TAG`, but nothing
 * here offers Tags a Filters button; see ListHeader.tsx). */
export type GqlFilterNamespace =
  | "Person"
  | "Family"
  | "Event"
  | "Place"
  | "Repository"
  | "Source"
  | "Citation"
  | "Media"
  | "Note";

/** Every GqlFilterNamespace, for runtime checks (e.g. validating a stored
 * Custom Rule or Saved Filter's `namespace`). */
export const GQL_FILTER_NAMESPACES: readonly GqlFilterNamespace[] = [
  "Person", "Family", "Event", "Place", "Repository", "Source", "Citation", "Media", "Note",
];

export function isGqlFilterNamespace(value: unknown): value is GqlFilterNamespace {
  return (GQL_FILTER_NAMESPACES as readonly unknown[]).includes(value);
}

/** Which GOQL namespace (if any) a list view's presets come from --
 * `undefined` for a view with no presets in the catalog yet, which the
 * "Filters" trigger in ListHeader.tsx uses to decide whether to render at
 * all. Keyed by `ViewConfig.key` (views.ts), not the namespace string
 * itself, since a view's key is already lowercase/singular
 * ("person"/"family") and every namespace here happens to be that
 * capitalized -- kept as an explicit map rather than a capitalize() call so
 * a future namespace whose view key doesn't match this trivially (plural,
 * different casing, ...) doesn't slip through silently. Deliberately omits
 * `tag` -- every other primary view gets Filters, Tags doesn't. */
const NAMESPACE_BY_VIEW_KEY: Record<string, GqlFilterNamespace> = {
  person: "Person",
  family: "Family",
  event: "Event",
  place: "Place",
  repository: "Repository",
  source: "Source",
  citation: "Citation",
  media: "Media",
  note: "Note",
};

export function namespaceForViewKey(viewKey: string): GqlFilterNamespace | undefined {
  return NAMESPACE_BY_VIEW_KEY[viewKey];
}

export type GqlFilterCategory =
  | "Dates"
  | "Properties"
  | "Associations"
  | "Tags"
  | "Privacy"
  /** "Matches saved filter" rules (store/contextPresets.ts), one per
   * Saved Filter. */
  | "Saved filters"
  /** Not a real built-in category -- reserved for Custom Rules
   * (customRuleMedia.ts's customRuleAsPreset()), user-authored
   * primitives adapted into this same GqlFilterPreset shape so the picker
   * can list them alongside built-ins. No preset in this file's own
   * catalog below is ever given this category. */
  | "Custom";

export interface GqlFilterParam {
  name: string;
  label: string;
  /** "integer" gets a numeric input, validated as a plain (optionally
   * negative) whole number before being spliced in raw -- see
   * goqlFilterCombiner.ts's INTEGER_RE. "string" gets a plain text
   * input, sanitized (quotes/backslashes stripped, same convention
   * simpleSearch.ts/personSearch.ts already use for user-typed search
   * text) before being spliced into a `'...'` string literal -- this is
   * plain string interpolation into `where_expr` text, not a
   * parameterized query, so an unescaped value could otherwise break out
   * of the literal. */
  type: "integer" | "string";
}

/** A value a built-in rule needs beyond plain text/number -- only built-in
 * presets use these; Custom Rules stay on GqlFilterParam's two types (see
 * customRuleMedia.ts's isCustomRuleParam()). goqlFilterCombiner.ts's
 * fillParams() renders each:
 *
 * - "regex": a regular expression, spliced into a `'...'` literal with
 *   quotes stripped and backslashes doubled (so `\d` survives). The expr
 *   adds `(?i)` itself, matching gramps-core's case-insensitive regex
 *   rules.
 * - "datetime": "YYYY[-MM[-DD[ hh[:mm[:ss]]]]]" in the browser's local
 *   time, spliced as Unix seconds -- gramps-core's ChangedSinceBase
 *   (add_time() + time.mktime()) does the same.
 * - "choice": one of `options`, spliced raw; anything else is rejected.
 * - "gramps-type": a type name from `table` (or a custom name), replaced by
 *   a whole condition on `field` -- `(field.value == 12)` for a standard
 *   type, `(field.value == 0 and field.string == 'name')` for a custom one,
 *   the same equality gramps-core's GrampsType uses. */
export type GqlPresetParam =
  | GqlFilterParam
  | { name: string; label: string; type: "regex" | "datetime" }
  | { name: string; label: string; type: "choice"; options: { value: string; label: string }[] }
  | { name: string; label: string; type: "gramps-type"; table: GrampsTypeTable; field: string };

export interface GqlFilterPreset {
  id: string;
  label: string;
  category: GqlFilterCategory;
  namespace: GqlFilterNamespace;
  /** Matches the corresponding gramps-core rule's name, for cross-reference. */
  sourceRule: string;
  expr: string;
  params?: GqlPresetParam[];
  supported: boolean;
  notes?: string;
  /** Set on an app-state rule (store/contextPresets.ts) that can't be
   * built right now -- e.g. "no home person is set". Compiling it throws
   * this, phrased to follow the rule's label. */
  unavailableReason?: string;
}

/** Rules that mean the same thing on (nearly) every object type -- tags,
 * privacy, and "has any notes/media/sources/attributes" -- generated per
 * namespace instead of hand-copied. Person's own copies are hand-written
 * in the main catalog below (their ids -- "has-tag", "private", ... --
 * predate this table and are referenced by stored Saved Filters, so they
 * keep them); every other namespace gets `<viewkey>-<rule>` ids.
 *
 * Each flag says whether that namespace's GOQL spec has the field at all
 * (checked by compiling against every namespace). `sourceRule` names the
 * gramps-core rule in rules/<type>/ where one exists -- the has-notes/
 * has-media/has-sources ones are its count-based HasNote/HasGallery/
 * HasSourceCount run as "greater than 0". gramps-core has no "has any
 * attribute" rule (its HasAttribute matches one named attribute), and no
 * has-notes rule for Repository or Media, so those cite "" and are tested
 * against the object's own list being non-empty instead. */
interface GenericRuleTarget {
  namespace: GqlFilterNamespace;
  idPrefix: string;
  plural: string;
  privateRule: string;
  notes: string | false;
  media: string | false;
  sources: string | false;
  attributes: boolean;
}

const GENERIC_RULE_TARGETS: GenericRuleTarget[] = [
  { namespace: "Family", idPrefix: "family", plural: "Families", privateRule: "FamilyPrivate", notes: "HasNote", media: "HasGallery", sources: "HasSourceCount", attributes: true },
  { namespace: "Event", idPrefix: "event", plural: "Events", privateRule: "EventPrivate", notes: "HasNote", media: "HasGallery", sources: "HasSourceCount", attributes: true },
  { namespace: "Place", idPrefix: "place", plural: "Places", privateRule: "PlacePrivate", notes: "HasNote", media: "HasGallery", sources: "HasSourceCount", attributes: false },
  { namespace: "Repository", idPrefix: "repository", plural: "Repositories", privateRule: "RepoPrivate", notes: "", media: false, sources: false, attributes: false },
  { namespace: "Source", idPrefix: "source", plural: "Sources", privateRule: "SourcePrivate", notes: "HasNote", media: "HasGallery", sources: false, attributes: true },
  { namespace: "Citation", idPrefix: "citation", plural: "Citations", privateRule: "CitationPrivate", notes: "HasNote", media: "HasGallery", sources: false, attributes: true },
  { namespace: "Media", idPrefix: "media", plural: "Media", privateRule: "MediaPrivate", notes: "", media: false, sources: "HasSourceCount", attributes: true },
  { namespace: "Note", idPrefix: "note", plural: "Notes", privateRule: "NotePrivate", notes: false, media: false, sources: false, attributes: false },
];

function genericPresets(g: GenericRuleTarget): GqlFilterPreset[] {
  const out: GqlFilterPreset[] = [];
  if (g.notes !== false) {
    out.push({
      id: `${g.idPrefix}-has-notes`, label: `${g.plural} with notes`, category: "Associations",
      namespace: g.namespace, sourceRule: g.notes, expr: "any(n for n in notes)", supported: true,
    });
  }
  if (g.media !== false) {
    out.push({
      id: `${g.idPrefix}-has-media`, label: `${g.plural} with media`, category: "Associations",
      namespace: g.namespace, sourceRule: g.media, expr: "any(m for m in media)", supported: true,
    });
  }
  if (g.sources !== false) {
    out.push({
      id: `${g.idPrefix}-has-sources`, label: `${g.plural} with sources`, category: "Associations",
      namespace: g.namespace, sourceRule: g.sources, expr: "len([c for c in citations]) > 0", supported: true,
    });
  }
  if (g.attributes) {
    out.push({
      id: `${g.idPrefix}-has-attributes`, label: `${g.plural} with attributes`, category: "Properties",
      namespace: g.namespace, sourceRule: "", expr: "len([a for a in attribute_list]) > 0", supported: true,
    });
  }
  out.push(
    {
      id: `${g.idPrefix}-has-tag`, label: "Tagged", category: "Tags", namespace: g.namespace,
      sourceRule: "HasTag", expr: "any(t.name == '{tagName}' for t in tags)",
      params: [{ name: "tagName", label: "Tag name", type: "string" }], supported: true,
    },
    {
      id: `${g.idPrefix}-private`, label: "Private", category: "Privacy", namespace: g.namespace,
      sourceRule: g.privateRule, expr: "private == True", supported: true,
    },
    {
      id: `${g.idPrefix}-not-private`, label: "Not private", category: "Privacy", namespace: g.namespace,
      sourceRule: "", expr: "private == False", supported: true,
    },
  );
  return out;
}

/** Rules with values, shared by several types -- gramps-core's
 * HasIdOf, RegExpIdOf, ChangedSince, the HasNote... rules, HasReferenceCountOf and
 * MatchesSourceConfidence, each of which exists (with the same base class)
 * in most rules/<type>/ modules. Enabled per type in DETAIL_RULE_TARGETS. */
const CONFIDENCE_OPTIONS = [
  { value: "0", label: "Very Low" },
  { value: "1", label: "Low" },
  { value: "2", label: "Normal" },
  { value: "3", label: "High" },
  { value: "4", label: "Very High" },
];

const COMPARISON_OPTIONS = [
  { value: ">", label: "more than" },
  { value: "<", label: "fewer than" },
  { value: "==", label: "exactly" },
];

function detailPresets(namespace: GqlFilterNamespace, idPrefix: string, hasNotes: boolean, hasCitations: boolean): GqlFilterPreset[] {
  const out: GqlFilterPreset[] = [
    {
      id: `${idPrefix}-id-is`, label: "Gramps ID is", category: "Properties", namespace,
      sourceRule: "HasIdOf", expr: "gramps_id == '{id}'",
      params: [{ name: "id", label: "ID", type: "string" }], supported: true,
    },
    {
      id: `${idPrefix}-id-matches`, label: "Gramps ID matches a regular expression", category: "Properties", namespace,
      sourceRule: "RegExpIdOf", expr: "regex(gramps_id, '(?i){pattern}')",
      params: [{ name: "pattern", label: "Regular expression", type: "regex" }], supported: true,
    },
    {
      id: `${idPrefix}-changed-since`, label: "Changed since", category: "Dates", namespace,
      sourceRule: "ChangedSince", expr: "change >= {since}",
      params: [{ name: "since", label: "YYYY-MM-DD hh:mm", type: "datetime" }], supported: true,
      notes: "gramps-core's ChangedSince also takes an optional 'but before' time; combine with NOT on a second Changed since for that.",
    },
    {
      id: `${idPrefix}-reference-count`, label: "Number of references", category: "Associations", namespace,
      sourceRule: "HasReferenceCountOf", expr: "len(backlinks) {comparison} {count}",
      params: [
        { name: "comparison", label: "Comparison", type: "choice", options: COMPARISON_OPTIONS },
        { name: "count", label: "Count", type: "integer" },
      ],
      supported: true,
    },
  ];
  if (hasNotes) {
    out.push(
      {
        id: `${idPrefix}-notes-contain`, label: "Notes contain text", category: "Associations", namespace,
        sourceRule: "HasNoteMatchingSubstringOf", expr: "any('{text}' in n.text.string for n in notes)",
        params: [{ name: "text", label: "Text", type: "string" }], supported: true,
      },
      {
        id: `${idPrefix}-notes-match`, label: "Notes match a regular expression", category: "Associations", namespace,
        sourceRule: "HasNoteRegexp", expr: "any(regex(n.text.string, '(?i){pattern}') for n in notes)",
        params: [{ name: "pattern", label: "Regular expression", type: "regex" }], supported: true,
      },
      {
        id: `${idPrefix}-note-type`, label: "Has a note of type", category: "Associations", namespace,
        sourceRule: "HasNoteType", expr: "any({noteType} for n in notes)",
        params: [{ name: "noteType", label: "Note type", type: "gramps-type", table: "NoteType", field: "n.type" }],
        supported: true,
      },
    );
  }
  if (hasCitations) {
    out.push({
      id: `${idPrefix}-citation-confidence`, label: "Has a citation with confidence at least", category: "Associations",
      namespace, sourceRule: "MatchesSourceConfidence", expr: "any(c.confidence >= {level} for c in citations)",
      params: [{ name: "level", label: "Confidence", type: "choice", options: CONFIDENCE_OPTIONS }], supported: true,
    });
  }
  return out;
}

/** `notes`/`citations`: whether the type has those lists at all (Notes have
 * neither; Sources, Citations and Repositories have no citations). */
const DETAIL_RULE_TARGETS: { namespace: GqlFilterNamespace; idPrefix: string; notes: boolean; citations: boolean }[] = [
  { namespace: "Family", idPrefix: "family", notes: true, citations: true },
  { namespace: "Event", idPrefix: "event", notes: true, citations: true },
  { namespace: "Place", idPrefix: "place", notes: true, citations: true },
  { namespace: "Repository", idPrefix: "repository", notes: true, citations: false },
  { namespace: "Source", idPrefix: "source", notes: true, citations: false },
  { namespace: "Citation", idPrefix: "citation", notes: true, citations: false },
  { namespace: "Media", idPrefix: "media", notes: true, citations: true },
  { namespace: "Note", idPrefix: "note", notes: false, citations: false },
];

/** "<field> contains <text>" -- gramps-core's match_substring() without
 * regex, which is case-insensitive like GOQL's `in`. */
function containsPreset(
  namespace: GqlFilterNamespace, id: string, label: string, sourceRule: string, field: string,
): GqlFilterPreset {
  return {
    id, label, category: "Properties", namespace, sourceRule, expr: `'{text}' in ${field}`,
    params: [{ name: "text", label: "Text", type: "string" }], supported: true,
  };
}

/** gramps-core's HasAttribute: an attribute of that type whose value
 * contains the text. */
function attributePreset(namespace: GqlFilterNamespace, idPrefix: string, table: GrampsTypeTable): GqlFilterPreset {
  return {
    id: `${idPrefix}-attribute`, label: "Has attribute", category: "Properties", namespace,
    sourceRule: "HasAttribute", expr: "any({attributeType} and '{value}' in a.value for a in attribute_list)",
    params: [
      { name: "attributeType", label: "Attribute", type: "gramps-type", table, field: "a.type" },
      { name: "value", label: "Value contains", type: "string" },
    ],
    supported: true,
  };
}

/** A plain sort-value range, like Birth date between -- gramps-core's
 * HasData/HasCitation/HasMedia match one fuzzy date with Date.match(). */
function dateBetweenPreset(namespace: GqlFilterNamespace, id: string, label: string, sourceRule: string): GqlFilterPreset {
  return {
    id, label, category: "Dates", namespace, sourceRule,
    expr: "Date('{startDate}') <= date.sortval <= Date('{endDate}')",
    params: [
      { name: "startDate", label: "Start date", type: "string" },
      { name: "endDate", label: "End date", type: "string" },
    ],
    supported: true,
    notes: `gramps-core's ${sourceRule} matches one date with Date.match() (fuzzy, so 'about 1850' overlaps a range); this is a plain range on the sort value instead, same as Birth date between. Items with no date never match.`,
  };
}

const ADDRESS_FIELDS = ["street", "locality", "city", "county", "state", "country", "postal", "phone"];

/** A family member's name or ID -- gramps-core's FatherHasNameOf/
 * MotherHasNameOf/ChildHasNameOf (HasNameOf with only the given name or
 * the surname filled in, over the primary and alternate names) and
 * FatherHasIdOf/MotherHasIdOf/ChildHasIdOf (RegExpIdBase). `who` is
 * "father", "mother" or "child"; a child's condition is wrapped in
 * any(... for c in children). */
function familyMemberPresets(who: "father" | "mother" | "child"): GqlFilterPreset[] {
  const p = who === "child" ? "c" : who;
  const wrap = (cond: string) => (who === "child" ? `any(${cond} for c in children)` : cond);
  const label = who === "child" ? "A child's" : who === "father" ? "Father's" : "Mother's";
  const rule = who === "child" ? "Child" : who === "father" ? "Father" : "Mother";
  const text = [{ name: "text", label: "Text", type: "string" as const }];
  return [
    {
      id: `family-${who}-given-name-contains`, label: `${label} given name contains`, category: "Properties",
      namespace: "Family", sourceRule: `${rule}HasNameOf`,
      expr: wrap(`('{text}' in ${p}.primary_name.first_name or any('{text}' in n.first_name for n in ${p}.alternate_names))`),
      params: text, supported: true,
    },
    {
      id: `family-${who}-surname-contains`, label: `${label} surname contains`, category: "Properties",
      namespace: "Family", sourceRule: `${rule}HasNameOf`,
      expr: wrap(
        `('{text}' in ${p}.primary_name.surname_list[0].surname or any('{text}' in n.surname_list[0].surname for n in ${p}.alternate_names))`,
      ),
      params: text, supported: true,
      notes: "Checks each name's first surname, which is its primary one unless a name with several surnames marks a later one primary.",
    },
    {
      id: `family-${who}-id-matches`, label: `${label} Gramps ID matches a regular expression`, category: "Properties",
      namespace: "Family", sourceRule: `${rule}HasIdOf`, expr: wrap(`regex(${p}.gramps_id, '(?i){pattern}')`),
      params: [{ name: "pattern", label: "Regular expression", type: "regex" }], supported: true,
    },
  ];
}

/** Rules only one type has (rules/<type>/). */
const typeSpecificPresets: GqlFilterPreset[] = [
  {
    id: "event-type", label: "Event type is", category: "Properties", namespace: "Event",
    sourceRule: "HasType", expr: "{eventType}",
    params: [{ name: "eventType", label: "Event type", type: "gramps-type", table: "EventType", field: "type" }],
    supported: true,
  },
  dateBetweenPreset("Event", "event-date-between", "Event date between", "HasData"),
  containsPreset("Event", "event-description-contains", "Description contains", "HasData", "description"),
  attributePreset("Event", "event", "AttributeType"),
  {
    id: "place-type", label: "Place type is", category: "Properties", namespace: "Place",
    sourceRule: "HasData", expr: "{placeType}",
    params: [{ name: "placeType", label: "Place type", type: "gramps-type", table: "PlaceType", field: "place_type" }],
    supported: true,
  },
  {
    id: "place-name-contains", label: "Name contains", category: "Properties", namespace: "Place",
    sourceRule: "HasData", expr: "'{text}' in name.value or any('{text}' in n.value for n in alt_names)",
    params: [{ name: "text", label: "Text", type: "string" }], supported: true,
    notes: "Checks the place's own name and its alternative names, like gramps-core's HasData (get_all_names()) -- not the full title built from enclosing places.",
  },
  containsPreset("Place", "place-code-contains", "Code contains", "HasData", "code"),
  {
    id: "place-no-coordinates", label: "Places without coordinates", category: "Properties", namespace: "Place",
    sourceRule: "HasNoLatOrLon", expr: "regex(lat, '^\\\\s*$') or regex(long, '^\\\\s*$')", supported: true,
  },

  // -- Family (rules/family/) ----------------------------------------------
  ...familyMemberPresets("father"),
  ...familyMemberPresets("mother"),
  ...familyMemberPresets("child"),
  {
    id: "family-relationship-type", label: "Relationship type is", category: "Properties", namespace: "Family",
    sourceRule: "HasRelType", expr: "{relType}",
    params: [{ name: "relType", label: "Relationship type", type: "gramps-type", table: "FamilyRelType", field: "type" }],
    supported: true,
  },
  {
    id: "family-child-count", label: "Number of children", category: "Properties", namespace: "Family",
    sourceRule: "", expr: "len(children) {comparison} {count}",
    params: [
      { name: "comparison", label: "Comparison", type: "choice", options: COMPARISON_OPTIONS },
      { name: "count", label: "Count", type: "integer" },
    ],
    supported: true,
  },
  {
    id: "family-event-type", label: "Has a family event of type", category: "Dates", namespace: "Family",
    sourceRule: "HasEvent", expr: "any({eventType} for e in events)",
    params: [{ name: "eventType", label: "Event type", type: "gramps-type", table: "EventType", field: "e.type" }],
    supported: true,
  },
  {
    id: "family-event-date-between", label: "Has a family event of type, between dates", category: "Dates",
    namespace: "Family", sourceRule: "HasEvent",
    expr: "any({eventType} and Date('{startDate}') <= e.date.sortval <= Date('{endDate}') for e in events)",
    params: [
      { name: "eventType", label: "Event type", type: "gramps-type", table: "EventType", field: "e.type" },
      { name: "startDate", label: "Start date", type: "string" },
      { name: "endDate", label: "End date", type: "string" },
    ],
    supported: true,
    notes: "gramps-core's HasEvent matches one date with Date.match() (fuzzy, so 'about 1850' overlaps a range); this is a plain range on the sort value instead, same as Birth date between. Events with no date never match.",
  },
  {
    id: "family-event-place-contains", label: "Has a family event with place name containing", category: "Dates",
    namespace: "Family", sourceRule: "HasEvent", expr: "any('{text}' in e.place.name.value for e in events)",
    params: [{ name: "text", label: "Text", type: "string" }], supported: true,
    notes: "Checks the event place's own name; gramps-core's HasEvent checks its full displayed title, which also includes the places that enclose it.",
  },
  {
    id: "family-event-description-contains", label: "Has a family event with description containing", category: "Dates",
    namespace: "Family", sourceRule: "HasEvent", expr: "any('{text}' in e.description for e in events)",
    params: [{ name: "text", label: "Text", type: "string" }], supported: true,
  },
  attributePreset("Family", "family", "AttributeType"),
  {
    id: "family-source-id-is", label: "Cites the source with Gramps ID", category: "Associations", namespace: "Family",
    sourceRule: "HasSourceOf", expr: "any(c.source.gramps_id == '{id}' for c in citations)",
    params: [{ name: "id", label: "Source ID", type: "string" }], supported: true,
  },
  {
    id: "family-citation-page-contains", label: "Has a citation with Volume/Page containing", category: "Associations",
    namespace: "Family", sourceRule: "HasCitation", expr: "any('{text}' in c.page for c in citations)",
    params: [{ name: "text", label: "Text", type: "string" }], supported: true,
  },
  {
    id: "family-lds-count", label: "Number of LDS ordinances", category: "Properties", namespace: "Family",
    sourceRule: "HasLDS", expr: "len([l for l in lds_ord_list]) {comparison} {count}",
    params: [
      { name: "comparison", label: "Comparison", type: "choice", options: COMPARISON_OPTIONS },
      { name: "count", label: "Count", type: "integer" },
    ],
    supported: true,
  },

  // -- Source (rules/source/; the text fields are HasSourceBase's) ----------
  containsPreset("Source", "source-title-contains", "Title contains", "MatchesTitleSubstringOf", "title"),
  containsPreset("Source", "source-author-contains", "Author contains", "HasSourceBase", "author"),
  containsPreset("Source", "source-abbreviation-contains", "Abbreviation contains", "HasSourceBase", "abbrev"),
  containsPreset("Source", "source-publication-contains", "Publication info contains", "HasSourceBase", "pubinfo"),
  {
    id: "source-repository-count", label: "Number of repositories", category: "Associations", namespace: "Source",
    sourceRule: "HasRepository", expr: "len([r for r in reporef_list]) {comparison} {count}",
    params: [
      { name: "comparison", label: "Comparison", type: "choice", options: COMPARISON_OPTIONS },
      { name: "count", label: "Count", type: "integer" },
    ],
    supported: true,
  },
  {
    id: "source-call-number-contains", label: "Repository call number contains", category: "Associations",
    namespace: "Source", sourceRule: "HasRepositoryCallNumberRef",
    expr: "any('{text}' in r.call_number for r in reporef_list)",
    params: [{ name: "text", label: "Text", type: "string" }], supported: true,
  },
  attributePreset("Source", "source", "SrcAttributeType"),

  // -- Citation (rules/citation/) -----------------------------------------
  containsPreset("Citation", "citation-page-contains", "Volume/Page contains", "MatchesPageSubstringOf", "page"),
  {
    id: "citation-confidence", label: "Confidence at least", category: "Properties", namespace: "Citation",
    sourceRule: "HasCitation", expr: "confidence >= {level}",
    params: [{ name: "level", label: "Confidence", type: "choice", options: CONFIDENCE_OPTIONS }], supported: true,
  },
  dateBetweenPreset("Citation", "citation-date-between", "Date between", "HasCitation"),
  {
    id: "citation-source-id-is", label: "Source's Gramps ID is", category: "Associations", namespace: "Citation",
    sourceRule: "HasSourceIdOf", expr: "source.gramps_id == '{id}'",
    params: [{ name: "id", label: "ID", type: "string" }], supported: true,
    notes: "gramps-core 6.0's HasSourceIdOf never matches (it has no prepare() to look the ID up); this does what it describes.",
  },
  {
    id: "citation-source-id-matches", label: "Source's Gramps ID matches a regular expression", category: "Associations",
    namespace: "Citation", sourceRule: "RegExpSourceIdOf", expr: "regex(source.gramps_id, '(?i){pattern}')",
    params: [{ name: "pattern", label: "Regular expression", type: "regex" }], supported: true,
  },
  containsPreset("Citation", "citation-source-title-contains", "Source title contains", "HasSource", "source.title"),
  containsPreset("Citation", "citation-source-author-contains", "Source author contains", "HasSource", "source.author"),
  attributePreset("Citation", "citation", "SrcAttributeType"),

  // -- Media (rules/media/; the text fields are HasMedia's) ---------------
  containsPreset("Media", "media-title-contains", "Title contains", "HasMedia", "desc"),
  containsPreset("Media", "media-type-contains", "Media type contains", "HasMedia", "mime"),
  containsPreset("Media", "media-path-contains", "Path contains", "HasMedia", "path"),
  dateBetweenPreset("Media", "media-date-between", "Date between", "HasMedia"),
  attributePreset("Media", "media", "AttributeType"),
  {
    id: "media-source-id-is", label: "Cites the source with Gramps ID", category: "Associations", namespace: "Media",
    sourceRule: "HasSourceOf", expr: "any(c.source.gramps_id == '{id}' for c in citations)",
    params: [{ name: "id", label: "Source ID", type: "string" }], supported: true,
  },
  {
    id: "media-citation-page-contains", label: "Has a citation with Volume/Page containing", category: "Associations",
    namespace: "Media", sourceRule: "HasCitation", expr: "any('{text}' in c.page for c in citations)",
    params: [{ name: "text", label: "Text", type: "string" }], supported: true,
  },

  // -- Repository (rules/repository/; the fields are HasRepo's) -----------
  containsPreset("Repository", "repository-name-contains", "Name contains", "MatchesNameSubstringOf", "name"),
  {
    id: "repository-type", label: "Repository type is", category: "Properties", namespace: "Repository",
    sourceRule: "HasRepo", expr: "{repositoryType}",
    params: [{ name: "repositoryType", label: "Repository type", type: "gramps-type", table: "RepositoryType", field: "type" }],
    supported: true,
  },
  {
    id: "repository-address-contains", label: "Address contains", category: "Properties", namespace: "Repository",
    sourceRule: "HasRepo",
    expr: `any(${ADDRESS_FIELDS.map((f) => `'{text}' in a.${f}`).join(" or ")} for a in address_list)`,
    params: [{ name: "text", label: "Text", type: "string" }], supported: true,
    notes: "Checks each address field on its own; gramps-core's HasRepo joins them with ', ' first, so text spanning two fields (\"Main St, Springfield\") only matches there.",
  },
  {
    id: "repository-url-contains", label: "Web address contains", category: "Properties", namespace: "Repository",
    sourceRule: "HasRepo", expr: "any('{text}' in u.path or '{text}' in u.desc for u in urls)",
    params: [{ name: "text", label: "Text", type: "string" }], supported: true,
  },

  // -- Note (rules/note/) --------------------------------------------------
  containsPreset("Note", "note-text-contains", "Text contains", "MatchesRegexpOf", "text.string"),
  {
    id: "note-text-matches", label: "Text matches a regular expression", category: "Properties", namespace: "Note",
    sourceRule: "MatchesRegexpOf", expr: "regex(text.string, '(?i){pattern}')",
    params: [{ name: "pattern", label: "Regular expression", type: "regex" }], supported: true,
  },
  {
    id: "note-type", label: "Note type is", category: "Properties", namespace: "Note",
    sourceRule: "HasType", expr: "{noteType}",
    params: [{ name: "noteType", label: "Note type", type: "gramps-type", table: "NoteType", field: "type" }],
    supported: true,
  },
];

const handWrittenPresets: GqlFilterPreset[] = [
  // -- Dates --------------------------------------------------------------
  {
    id: "birth-year-between",
    label: "Birth date between",
    category: "Dates",
    namespace: "Person",
    sourceRule: "HasBirth",
    expr: "Date('{startDate}') <= birth.date.sortval <= Date('{endDate}')",
    params: [
      { name: "startDate", label: "Start date", type: "string" },
      { name: "endDate", label: "End date", type: "string" },
    ],
    supported: true,
    notes:
      "HasBirth is broader than this -- it also matches a Place and a Description text; this preset covers only its Date field. Each bound accepts any Gramps date expression (e.g. \"1 Jan 1900\", \"1900\", \"before 1950\"), parsed via Gramps' own date parser -- not restricted to a bare year. Verified: matches Date('Jan 1, 1800') <= birth.date.sortval <= Date('Dec 31, 1850') against gramps-core's own example.gramps fixture exactly (145/145).",
  },
  {
    id: "death-year-between",
    label: "Death date between",
    category: "Dates",
    namespace: "Person",
    sourceRule: "HasDeath",
    expr: "Date('{startDate}') <= death.date.sortval <= Date('{endDate}')",
    params: [
      { name: "startDate", label: "Start date", type: "string" },
      { name: "endDate", label: "End date", type: "string" },
    ],
    supported: true,
    notes: "Same scope note as birth-year-between, for HasDeath.",
  },

  // -- Properties -----------------------------------------------------------
  {
    id: "females",
    label: "Females",
    category: "Properties",
    namespace: "Person",
    sourceRule: "IsFemale",
    expr: "gender == Person.FEMALE",
    supported: true,
  },
  {
    id: "unknown-gender",
    label: "People with unknown gender",
    category: "Properties",
    namespace: "Person",
    sourceRule: "HasUnknownGender",
    expr: "gender == Person.UNKNOWN",
    supported: true,
  },
  {
    id: "males",
    label: "Males",
    category: "Properties",
    namespace: "Person",
    sourceRule: "IsMale",
    expr: "gender == Person.MALE",
    supported: true,
  },
  {
    id: "has-other-gender",
    label: "People who are neither male nor female",
    category: "Properties",
    namespace: "Person",
    sourceRule: "HasOtherGender",
    expr: "gender == Person.OTHER",
    supported: true,
  },
  {
    id: "has-alternate-name",
    label: "People with an alternate name",
    category: "Properties",
    namespace: "Person",
    sourceRule: "HasAlternateName",
    expr: "len([n for n in alternate_names]) > 0",
    supported: true,
    notes:
      "The real rule is exactly bool(person.alternate_names) -- a plain count, no per-name field condition -- so GOQL's len() (array-length comparisons) is a direct, faithful translation. Verified exact match against gramps-core's own example.gramps fixture (2/2).",
  },
  {
    id: "has-nickname",
    label: "People with a nickname",
    category: "Properties",
    namespace: "Person",
    sourceRule: "HasNickname",
    expr: "primary_name.nick != ''",
    supported: true,
    notes:
      "Field is `nick`, not `nick_name` (fixed -- the old name doesn't exist on Name's schema). gramps-core's real HasNickname also checks every alternate name and a person-level Attribute of type NICKNAME; GOQL can only reach primary_name, so this only catches a nickname stored there. Verified against gramps-core's own example.gramps fixture (3/3 match on that data, which happens not to exercise the alternate-name/Attribute cases).",
  },
  {
    id: "adopted",
    label: "Adopted people",
    category: "Properties",
    namespace: "Person",
    sourceRule: "HaveAltFamilies",
    expr: "any(ref for ref in child_refs if ref.frel.value == ChildRefType.ADOPTED or ref.mrel.value == ChildRefType.ADOPTED)",
    supported: true,
    notes:
      "The real rule (HaveAltFamilies) finds, for each of a person's parent families, the ChildRef entry whose `ref` is this person's own handle, then checks that entry's own frel/mrel against ChildRefType.ADOPTED. GOQL's child_refs is a new kind of collection built for exactly this: a *self-linked* Collection whose condition is about a field on the join/link itself (the specific ChildRef entry naming this person), not the joined Family row's own fields. Verified exact match against gramps-core's own example.gramps fixture (2/2).",
  },
  {
    id: "has-children",
    label: "People with children",
    category: "Properties",
    namespace: "Person",
    sourceRule: "HaveChildren",
    expr: "any(f for f in families if len([c for c in f.children]) > 0)",
    supported: true,
  },
  {
    id: "incomplete-names",
    label: "People with incomplete names",
    category: "Properties",
    namespace: "Person",
    sourceRule: "IncompleteNames",
    expr: "primary_name.first_name == '' or primary_name.surname_list[0].surname == ''",
    supported: true,
    notes:
      "The core rule also checks every alternate name (and treats a name with no surname_list entries at all as incomplete too, not just an empty surname); this preset only checks the *primary* name -- alternate_names could now be reached too via any(n.first_name == '' for n in alternate_names)-style conditions (any(path, condition) shipped after this preset was written), but doing so for every field IncompleteNames itself checks is still a follow-up, not done here. Verified exact match against gramps-core's own example.gramps fixture (76/76) -- that data happens not to exercise the alternate-name gap.",
  },
  {
    id: "no-marriage-records",
    label: "People with no marriage records",
    category: "Properties",
    namespace: "Person",
    sourceRule: "NeverMarried",
    expr: "len([f for f in families]) == 0",
    supported: true,
    notes:
      "\"Marriage\" here means gramps-core's own NeverMarried: zero family_list entries of *any* FamilyRelType (married, unmarried partner, civil union, ...) -- not specifically type MARRIED, despite the name. Verified exact match against example.gramps (751/751).",
  },
  {
    id: "multiple-marriages",
    label: "People with multiple marriage records",
    category: "Properties",
    namespace: "Person",
    sourceRule: "MultipleMarriages",
    expr: "len([f for f in families]) > 1",
    supported: true,
    notes: "Same \"any FamilyRelType counts\" scope as no-marriage-records. Verified exact match against example.gramps (50/50).",
  },
  {
    id: "no-birth-date",
    label: "People without a known birth date",
    category: "Properties",
    namespace: "Person",
    sourceRule: "NoBirthdate",
    expr: "birth.date.sortval is None or birth.date.sortval == 0",
    supported: true,
  },
  {
    id: "no-death-date",
    label: "People without a known death date",
    category: "Properties",
    namespace: "Person",
    sourceRule: "NoDeathdate",
    expr: "death.date.sortval is None or death.date.sortval == 0",
    supported: true,
  },
  {
    id: "incomplete-events",
    label: "People with incomplete events",
    category: "Properties",
    namespace: "Person",
    sourceRule: "PersonWithIncompleteEvent",
    expr: "any(e.place == '' or e.place is None or e.date.sortval is None for e in events)",
    supported: true,
    notes:
      "Fixed: an Event's unset `place` is the empty string at runtime, never null (confirmed directly against a fresh Event()) -- the old `place is None` check matched *zero* rows instead of the correct set. gramps-core's own \"missing date\" half of this rule is effectively dead code (a Gramps Date object is never actually None, so `not event.date` never fires in practice); this GOQL version is intentionally a bit stricter, since it can correctly detect an empty/invalid date via sortval too. Verified exact match against example.gramps (745/745) with this fix.",
  },
  {
    id: "families-incomplete-events",
    label: "Families with incomplete events",
    category: "Properties",
    namespace: "Family",
    sourceRule: "FamilyWithIncompleteEvent",
    expr: "any(e.place == '' or e.place is None or e.date.sortval is None for e in events)",
    supported: true,
    notes:
      "gramps-core's real FamilyWithIncompleteEvent is, surprisingly, a *Person* rule (rules/person/_familywithincompleteevent.py) that walks person.family_list's own families' events -- there's no Family-typed rule of this name in gramps-core at all. This preset is a deliberate Family-namespace reformulation of the same underlying check (which family, not which person, has the incomplete event), not a literal port; same place-empty-string fix and same date-check caveat as incomplete-events. Verified exact match against example.gramps (397/397, checked per-family against the real rule's own inner loop) with this fix -- the old `place is None` form matched zero rows here too.",
  },
  {
    id: "missing-parents",
    label: "People missing parents",
    category: "Properties",
    namespace: "Person",
    sourceRule: "MissingParent",
    expr: "len([f for f in parent_families]) == 0 or any(f.father_handle is None or f.mother_handle is None for f in parent_families)",
    supported: true,
  },
  {
    id: "disconnected",
    label: "Disconnected people",
    category: "Properties",
    namespace: "Person",
    sourceRule: "Disconnected",
    expr: "len([f for f in parent_families]) == 0 and len([f for f in families]) == 0",
    supported: true,
  },

  // -- Associations ---------------------------------------------------------
  {
    id: "has-media",
    label: "People with media",
    category: "Associations",
    namespace: "Person",
    sourceRule: "HavePhotos",
    expr: "any(m for m in media)",
    supported: true,
  },
  {
    id: "has-notes",
    label: "People having notes",
    category: "Associations",
    namespace: "Person",
    sourceRule: "HasNote",
    expr: "any(n for n in notes)",
    supported: true,
  },
  {
    id: "has-sources",
    label: "People with sources",
    category: "Associations",
    namespace: "Person",
    sourceRule: "HasSourceCount",
    expr: "len([c for c in citations]) > 0",
    supported: true,
    notes:
      "gramps-core's HasSourceCount literally counts len(citation_list) (Citations, not distinct Sources -- its own source comment says so), so len([c for c in citations]) > 0 is the direct, faithful translation, not an approximation. Verified exact match against example.gramps (2090/2090).",
  },
  {
    id: "has-addresses",
    label: "People with addresses",
    category: "Associations",
    namespace: "Person",
    sourceRule: "HasAddress",
    expr: "len([a for a in address_list]) > 0",
    supported: true,
    notes:
      "The real rule is parameterized (a count and a </==/> comparison), but this quick-pick preset only offers the simple 'has at least one' case -- len() handles that directly and correctly: address_list is always serialized as [] (never absent) even with no addresses, so len(...) > 0 doesn't misreport 'none' the way a raw JSON-path presence check would have. Verified exact match against gramps-core's own example.gramps fixture (1/1, using the rule's own 'greater than 0' parameterization).",
  },
  {
    id: "has-associations",
    label: "People with associations",
    category: "Associations",
    namespace: "Person",
    sourceRule: "HasAssociation",
    expr: "any(a for a in associations)",
    supported: true,
  },
  {
    id: "has-attributes",
    label: "People with attributes",
    category: "Properties",
    namespace: "Person",
    sourceRule: "",
    expr: "len([a for a in attribute_list]) > 0",
    supported: true,
  },

  // -- Tags -------------------------------------------------------------------
  {
    id: "has-tag",
    label: "Tagged",
    category: "Tags",
    namespace: "Person",
    sourceRule: "HasTag",
    expr: "any(t.name == '{tagName}' for t in tags)",
    params: [{ name: "tagName", label: "Tag name", type: "string" }],
    supported: true,
    notes:
      "Originally one hardcoded preset per tag name (a fixed list of common Gramps tag categories) -- replaced with a single rule taking the tag name as a value, since a tree's actual tags are user-defined, not this list. gramps-core's own HasTag resolves the name to a handle once at prepare() time and matches nothing at all if no tag by that name exists (silent, not an error) -- this GOQL translation behaves the same way: any(t.name == '...' for t in tags) is simply false if the name doesn't match any tag on the tree.",
  },

  // -- Privacy ------------------------------------------------------------
  {
    id: "private",
    label: "Private",
    category: "Privacy",
    namespace: "Person",
    sourceRule: "PeoplePrivate",
    expr: "private == True",
    supported: true,
  },
  {
    id: "not-private",
    label: "Not private",
    category: "Privacy",
    namespace: "Person",
    sourceRule: "PeoplePublic",
    expr: "private == False",
    supported: true,
  },
];

export const gqlFilterPresets: GqlFilterPreset[] = [
  ...handWrittenPresets,
  ...GENERIC_RULE_TARGETS.flatMap(genericPresets),
  ...DETAIL_RULE_TARGETS.flatMap((d) => detailPresets(d.namespace, d.idPrefix, d.notes, d.citations)),
  ...typeSpecificPresets,
];
