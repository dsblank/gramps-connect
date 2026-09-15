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

export type GqlFilterNamespace = "Person" | "Family";

/** Which GOQL namespace (if any) a list view's presets come from --
 * `undefined` for a view with no presets in the catalog yet, which the
 * "Filters" trigger in ListHeader.tsx uses to decide whether to render at
 * all. Keyed by `ViewConfig.key` (views.ts), not the namespace string
 * itself, since a view's key is already lowercase/singular
 * ("person"/"family") and every namespace here happens to be that
 * capitalized -- kept as an explicit map rather than a capitalize() call so
 * a future namespace whose view key doesn't match this trivially (plural,
 * different casing, ...) doesn't slip through silently. */
const NAMESPACE_BY_VIEW_KEY: Record<string, GqlFilterNamespace> = {
  person: "Person",
  family: "Family",
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
    sourceRule: "Birthdate",
    expr: "Date('Jan 1, {startYear}') <= birth.date.sortval <= Date('Dec 31, {endYear}')",
    params: [
      { name: "startYear", label: "Start year", type: "year" },
      { name: "endYear", label: "End year", type: "year" },
    ],
    supported: true,
  },
  {
    id: "death-year-between",
    label: "Death year between",
    category: "Dates",
    namespace: "Person",
    sourceRule: "Deathdate",
    expr: "Date('Jan 1, {startYear}') <= death.date.sortval <= Date('Dec 31, {endYear}')",
    params: [
      { name: "startYear", label: "Start year", type: "year" },
      { name: "endYear", label: "End year", type: "year" },
    ],
    supported: true,
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
    expr: "primary_name.nick_name != ''",
    supported: true,
  },
  {
    id: "adopted",
    label: "Adopted people",
    category: "Properties",
    namespace: "Person",
    sourceRule: "HasNoteRegexp / adoption via ChildRefType",
    expr: "",
    supported: false,
    notes:
      "Adoption type lives on the child_ref entry inside a *family's* child_ref_list, keyed to a specific child. GOQL's exists(parent_families, ...) has no way to reach 'the child_ref that refers to me' from the child's own Person row.",
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
      "The core rule also checks every alternate name; GOQL can only reach primary_name (see has-alternate-name), so this only catches an incomplete *primary* name.",
  },
  {
    id: "no-marriage-records",
    label: "People with no marriage records",
    category: "Properties",
    namespace: "Person",
    sourceRule: "NeverMarried",
    expr: "count(families) == 0",
    supported: true,
  },
  {
    id: "multiple-marriages",
    label: "People with multiple marriage records",
    category: "Properties",
    namespace: "Person",
    sourceRule: "MultipleMarriages",
    expr: "count(families) > 1",
    supported: true,
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
    expr: "exists(events, place is None or date.sortval is None)",
    supported: true,
  },
  {
    id: "families-incomplete-events",
    label: "Families with incomplete events",
    category: "Properties",
    namespace: "Family",
    sourceRule: "FamilyWithIncompleteEvent",
    expr: "exists(events, place is None or date.sortval is None)",
    supported: true,
    notes:
      "The core rule is a Person filter (person's own families' events); this is the direct Family-namespace equivalent. Combine with exists(Person's `families`, ...) to filter people instead.",
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
    sourceRule: "HasMedia",
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
    expr: "exists(citations, source.handle is not None)",
    supported: true,
    notes:
      "The core rule counts distinct Sources reachable via the person's citations. GOQL has no distinct-count across a two-hop relationship, so this checks 'has at least one citation whose source exists' rather than a source tally.",
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
    sourceRule: "PeoplePrivate / IsPrivate",
    expr: "private == True",
    supported: true,
  },
  {
    id: "not-private",
    label: "Not private",
    category: "Privacy",
    namespace: "Person",
    sourceRule: "IsPrivate(False)",
    expr: "private == False",
    supported: true,
  },
];
