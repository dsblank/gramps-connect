/**
 * GOQL (`where_expr`) equivalents for the classic gramps-core filter rules
 * (gramps/gen/filters/rules/person/*.py, family/*.py). Selection/combination
 * lives in ./../store/goqlFilterCombiner.ts and ./../store/goqlFilterTree.ts;
 * the "Filters" picker (./../components/FilterPickerDialog.tsx) is the UI on
 * top of both.
 *
 * `expr` uses `{placeholder}` tokens for the two rules that take user
 * input (a year range); every other entry is a complete, literal
 * `where_expr` string. `supported: false` entries have no faithful GOQL
 * translation today -- see each one's `notes`.
 */

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
  /** Not a real built-in category -- reserved for Custom Rules
   * (customRuleMedia.ts's customRuleAsPreset()), user-authored
   * primitives adapted into this same GqlFilterPreset shape so the picker
   * can list them alongside built-ins. No preset in this file's own
   * catalog below is ever given this category. */
  | "Custom";

export interface GqlFilterParam {
  name: string;
  label: string;
  type: "year";
}

export interface GqlFilterPreset {
  id: string;
  label: string;
  category: GqlFilterCategory;
  namespace: GqlFilterNamespace;
  /** Matches the corresponding gramps-core rule's name, for cross-reference. */
  sourceRule: string;
  expr: string;
  params?: GqlFilterParam[];
  supported: boolean;
  notes?: string;
}

const TAG_NAMES = [
  "Blog",
  "Children",
  "Citations",
  "Coronation",
  "Family",
  "Import",
  "Map",
  "Media",
  "Relationships",
  "Repository",
  "Tasks",
  "ToDo",
];

export const gqlFilterPresets: GqlFilterPreset[] = [
  // -- Dates --------------------------------------------------------------
  {
    id: "birth-year-between",
    label: "Birth year between",
    category: "Dates",
    namespace: "Person",
    sourceRule: "HasBirth",
    expr: "Date('Jan 1, {startYear}') <= birth.date.sortval <= Date('Dec 31, {endYear}')",
    params: [
      { name: "startYear", label: "Start year", type: "year" },
      { name: "endYear", label: "End year", type: "year" },
    ],
    supported: true,
    notes:
      "HasBirth is broader than this -- it also matches a Place and a Description text, and its single Date field accepts any Gramps date expression (not just a year range). This preset covers only the year-range portion. Verified: matches Date('Jan 1, 1800') <= birth.date.sortval <= Date('Dec 31, 1850') against gramps-core's own example.gramps fixture exactly (145/145).",
  },
  {
    id: "death-year-between",
    label: "Death year between",
    category: "Dates",
    namespace: "Person",
    sourceRule: "HasDeath",
    expr: "Date('Jan 1, {startYear}') <= death.date.sortval <= Date('Dec 31, {endYear}')",
    params: [
      { name: "startYear", label: "Start year", type: "year" },
      { name: "endYear", label: "End year", type: "year" },
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
    expr: "",
    supported: false,
    notes:
      "The rule checks person.alternate_names, but `alternate_names` isn't a registered GOQL collection (only primary_name is reachable) -- no exists()/count() form can express it today.",
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
    expr: "",
    supported: false,
    notes:
      "The real rule (HaveAltFamilies) finds, for each of a person's parent families, the ChildRef entry whose `ref` is this person's own handle, then checks that entry's own frel/mrel against ChildRefType.ADOPTED. GOQL's exists(parent_families, ...) join only ever exposes the *joined Family row's* own fields to its condition (confirmed via query.py's Collection.ref_field mechanism) -- frel/mrel live on the ChildRef struct itself, a sibling of `ref`, not reachable through that condition. Same class of gap as has-alternate-name/has-addresses.",
  },
  {
    id: "has-children",
    label: "People with children",
    category: "Properties",
    namespace: "Person",
    sourceRule: "HaveChildren",
    expr: "exists(families, count(children) > 0)",
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
      "The core rule also checks every alternate name (and treats a name with no surname_list entries at all as incomplete too, not just an empty surname); GOQL can only reach primary_name (see has-alternate-name), so this only catches an incomplete *primary* name with at least one surname entry present. Verified exact match against gramps-core's own example.gramps fixture (76/76) -- that data happens not to exercise the alternate-name gap.",
  },
  {
    id: "no-marriage-records",
    label: "People with no marriage records",
    category: "Properties",
    namespace: "Person",
    sourceRule: "NeverMarried",
    expr: "count(families) == 0",
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
    expr: "count(families) > 1",
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
    expr: "exists(events, place == '' or place is None or date.sortval is None)",
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
    expr: "exists(events, place == '' or place is None or date.sortval is None)",
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
    expr: "count(parent_families) == 0 or exists(parent_families, father_handle is None or mother_handle is None)",
    supported: true,
  },
  {
    id: "disconnected",
    label: "Disconnected people",
    category: "Properties",
    namespace: "Person",
    sourceRule: "Disconnected",
    expr: "count(parent_families) == 0 and count(families) == 0",
    supported: true,
  },

  // -- Associations ---------------------------------------------------------
  {
    id: "has-media",
    label: "People with media",
    category: "Associations",
    namespace: "Person",
    sourceRule: "HavePhotos",
    expr: "exists(media)",
    supported: true,
  },
  {
    id: "has-notes",
    label: "People having notes",
    category: "Associations",
    namespace: "Person",
    sourceRule: "HasNote",
    expr: "exists(notes)",
    supported: true,
  },
  {
    id: "has-sources",
    label: "People with sources",
    category: "Associations",
    namespace: "Person",
    sourceRule: "HasSourceCount",
    expr: "count(citations) > 0",
    supported: true,
    notes:
      "gramps-core's HasSourceCount literally counts len(citation_list) (Citations, not distinct Sources -- its own source comment says so), so count(citations) > 0 is the direct, faithful translation, not an approximation. Verified exact match against example.gramps (2090/2090).",
  },
  {
    id: "has-addresses",
    label: "People with addresses",
    category: "Associations",
    namespace: "Person",
    sourceRule: "HasAddress",
    expr: "",
    supported: false,
    notes:
      "address_list isn't a registered GOQL collection (unlike notes/citations/media/tags), so there's no exists(addresses) form. A raw JSON-path presence check would misreport 'no addresses at all' under three-valued NULL logic.",
  },
  {
    id: "has-associations",
    label: "People with associations",
    category: "Associations",
    namespace: "Person",
    sourceRule: "HasAssociation",
    expr: "exists(associations)",
    supported: true,
  },

  // -- Tags -------------------------------------------------------------------
  ...TAG_NAMES.map((tagName): GqlFilterPreset => ({
    id: `tag-${tagName.toLowerCase()}`,
    label: `Tag: ${tagName}`,
    category: "Tags",
    namespace: "Person",
    sourceRule: "HasTag",
    expr: `exists(tags, name == '${tagName}')`,
    supported: true,
  })),

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
