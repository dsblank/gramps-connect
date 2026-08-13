// What the FilterBar's "i" button explains, per view: which fields that
// view's rows can be matched on, what a path can reach from them, and a
// handful of working examples.
//
// Data, not code -- SearchHelpDialog renders whatever is here, and the
// shared half of the explanation (operators, and/or/not, like/regex/in,
// Date(...)) lives in the dialog itself since it's the same for every view.
//
// Everything here describes gramps-object-query-language, which is what
// actually parses a where_expr server-side -- see its
// README-query-language.md (plain language) and docs/where_expr.md (the
// field/relationship/collection reference these lists are drawn from). The
// examples are the *bare* expression, with no leading `Person`/`Family`
// type name and no surrounding quotes: the view's own endpoint already
// fixes the type, so the search box only ever holds the condition.
import type { ViewConfig } from "./views";

export interface HelpEntry {
  /** A field path, relationship name, or collection name, as typed. */
  name: string;
  description: string;
}

export interface HelpExample {
  /** A complete, runnable search expression -- clicking it in the dialog
   * puts exactly this in the search box. */
  expr: string;
  description: string;
}

export interface SearchHelp {
  /** The object type as the query language names it ("Person"), which is
   * also what its docs are indexed by. Shown so a reader can carry a
   * doc example over to the right list. */
  typeName: string;
  /** For a view that isn't the whole table -- Messages and Output are both
   * a fixed filter over one (see ViewConfig.baseFilter) -- what the search
   * is narrowing down, since the user's expression is AND-ed onto that
   * filter rather than replacing it. */
  scopeNote?: string;
  examples: HelpExample[];
  /** Fields on the row itself. Not exhaustive (anything stored on the
   * record is reachable as a path); the ones worth searching by. */
  fields: HelpEntry[];
  /** One-to-one hops a path can cross into another record. */
  relationships?: HelpEntry[];
  /** One-to-many lists, usable only as exists(...)/count(...)'s first
   * argument -- never as a path segment. */
  collections?: HelpEntry[];
}

// Repeated across most types, so written once. Each is a collection in
// gramps-object-query-language's registry, not a plain field: which of them
// a given type has follows Gramps' own object model (a Source has no
// citations, a Repository has neither citations nor media, a Tag has none
// at all).
const NOTES: HelpEntry = { name: "notes", description: "Notes attached to the record" };
const CITATIONS: HelpEntry = { name: "citations", description: "Citations attached to the record" };
const MEDIA: HelpEntry = { name: "media", description: "Photos and other media attached to the record" };
const TAGS: HelpEntry = { name: "tags", description: "Tags on the record, e.g. exists(tags, name == 'todo')" };

const PRIVATE: HelpEntry = { name: "private", description: "True for a record marked private" };
const CHANGE: HelpEntry = { name: "change", description: "When the record was last edited, as a number (larger is more recent)" };
const GRAMPS_ID: HelpEntry = { name: "gramps_id", description: "The Gramps ID shown in the first column, e.g. 'I0044'" };

// Media's own fields, shared by the Media view and the Output view (which
// is the same table under a fixed report/export tag filter).
const MEDIA_FIELDS: HelpEntry[] = [
  GRAMPS_ID,
  { name: "desc", description: "The description -- the Description column" },
  { name: "path", description: "The file's path or name" },
  { name: "mime", description: "The MIME type, e.g. 'image/jpeg' or 'application/pdf'" },
  { name: "checksum", description: "The file's checksum" },
  { name: "date.sortval", description: "The date recorded on the media, as a comparable number" },
  PRIVATE,
  CHANGE,
];

// Likewise for Note, shared by the Notes view and the Messages view.
const NOTE_FIELDS: HelpEntry[] = [
  GRAMPS_ID,
  { name: "text.string", description: "The note's text -- the Text column" },
  { name: "type.value", description: "The kind of note: NoteType.GENERAL, .RESEARCH, .TODO, .TRANSCRIPT, ..." },
  { name: "format", description: "Note.FLOWED or Note.FORMATTED" },
  PRIVATE,
  CHANGE,
];

const PERSON_HELP: SearchHelp = {
  typeName: "Person",
  examples: [
    { expr: "surname == 'Smith'", description: "Everyone whose last name is exactly Smith" },
    { expr: "like(given_name, 'J%')", description: "First name starting with J -- % stands for anything" },
    { expr: "'an' in given_name", description: "First name containing 'an' anywhere (Jane, Susan, Alexander)" },
    { expr: "gender == Person.MALE and surname == 'Smith'", description: "Both conditions at once" },
    { expr: "birth.date.sortval >= Date('Jan 1, 1968')", description: "Born on or after a date" },
    { expr: "birth.place.title == death.place.title", description: "Born and died in the same place" },
    { expr: "death.date.sortval is None", description: "No death date recorded" },
    { expr: "not exists(notes)", description: "Nobody has written a note about them" },
    { expr: "exists(citations, confidence >= Citation.CONF_HIGH)", description: "Has at least one well-sourced citation" },
  ],
  fields: [
    GRAMPS_ID,
    { name: "surname", description: "Last name from the primary name -- the Surname column" },
    { name: "given_name", description: "First name from the primary name -- the Given name column" },
    { name: "gender", description: "Person.MALE, Person.FEMALE, Person.UNKNOWN or Person.OTHER" },
    { name: "primary_name.nick", description: "Nickname; .suffix, .title and .call work the same way" },
    { name: "primary_name.surname_list[1].surname", description: "A second recorded surname, when there is one ([0] is the first)" },
    { name: "primary_name.type.value", description: "NameType.BIRTH, .MARRIED, .AKA, ..." },
    PRIVATE,
    CHANGE,
  ],
  relationships: [
    { name: "birth", description: "The person's birth event, e.g. birth.date.sortval, birth.place.title" },
    { name: "death", description: "The person's death event, e.g. death.description" },
  ],
  collections: [
    { name: "events", description: "Every recorded event, not just birth and death" },
    { name: "families", description: "Families they are a parent or spouse in" },
    { name: "parent_families", description: "Families they are a child in" },
    { name: "associations", description: "Other people linked to them by an association" },
    NOTES, CITATIONS, MEDIA, TAGS,
  ],
};

const FAMILY_HELP: SearchHelp = {
  typeName: "Family",
  examples: [
    { expr: "father.surname == 'Smith'", description: "Families whose father is a Smith" },
    { expr: "mother.given_name == 'Mary'", description: "Families whose mother is named Mary" },
    { expr: "father.surname == mother.surname", description: "Both parents share a last name" },
    { expr: "father.birth.date.sortval < Date('Jan 1, 1850')", description: "The father was born before 1850" },
    { expr: "exists(children, given_name == 'Steve')", description: "At least one child named Steve" },
    { expr: "count(children) > 2", description: "More than two children recorded" },
    { expr: "not exists(children)", description: "No children recorded at all" },
    { expr: "type.value == FamilyRelType.MARRIED", description: "Married couples only" },
  ],
  fields: [
    GRAMPS_ID,
    { name: "type.value", description: "FamilyRelType.MARRIED, .UNMARRIED, .CIVIL_UNION, .UNKNOWN or .CUSTOM" },
    { name: "father_handle", description: "The father's internal id -- father below is usually what you want" },
    { name: "mother_handle", description: "The mother's internal id" },
    PRIVATE,
    CHANGE,
  ],
  relationships: [
    { name: "father", description: "The father's own record, e.g. father.surname, father.death.date.sortval" },
    { name: "mother", description: "The mother's own record, e.g. mother.given_name" },
  ],
  collections: [
    { name: "children", description: "The family's children, e.g. count(children, gender == Person.MALE) > 1" },
    { name: "events", description: "Family events: marriage, divorce, ..." },
    NOTES, CITATIONS, MEDIA, TAGS,
  ],
};

const EVENT_HELP: SearchHelp = {
  typeName: "Event",
  examples: [
    { expr: "type.value == EventType.BIRTH", description: "Births only" },
    { expr: "place.title == 'Chicago, Cook, Illinois, USA'", description: "Everything that happened at one place" },
    { expr: "like(place.title, '%Illinois%')", description: "Anywhere whose name mentions Illinois" },
    { expr: "'accident' in description", description: "The description mentions an accident" },
    { expr: "date.sortval >= Date('Jan 1, 1900')", description: "Happened in 1900 or later" },
    { expr: "date.modifier == Date.MOD_ABOUT", description: "The date is only approximate" },
  ],
  fields: [
    GRAMPS_ID,
    { name: "type.value", description: "EventType.BIRTH, .DEATH, .MARRIAGE, .BURIAL, .CENSUS, ... -- the Type column" },
    { name: "description", description: "The event's description" },
    { name: "date.sortval", description: "The date as one comparable number; compare it against Date('...')" },
    { name: "date.modifier", description: "Date.MOD_ABOUT, .MOD_BEFORE, .MOD_AFTER, .MOD_RANGE, .MOD_SPAN" },
    { name: "date.quality", description: "Date.QUAL_ESTIMATED, .QUAL_CALCULATED or .QUAL_NONE" },
    PRIVATE,
    CHANGE,
  ],
  relationships: [
    { name: "place", description: "The place it happened, e.g. place.title, place.enclosed_by.title" },
  ],
  collections: [NOTES, CITATIONS, MEDIA, TAGS],
};

const PLACE_HELP: SearchHelp = {
  typeName: "Place",
  examples: [
    { expr: "like(title, '%, TX')", description: "Every place ending in Texas" },
    { expr: "place_type.value == PlaceType.CITY", description: "Cities only" },
    { expr: "enclosed_by.title == 'Cook County'", description: "Places directly inside one county" },
    { expr: "enclosed_by.enclosed_by.title == 'Illinois'", description: "Two levels up -- skipping the county to reach the state" },
    { expr: "lat == ''", description: "No coordinates recorded yet" },
  ],
  fields: [
    GRAMPS_ID,
    { name: "title", description: "The full name, enclosing places included -- the Title column" },
    { name: "name.value", description: "The place's own name, without the places around it" },
    { name: "place_type.value", description: "PlaceType.CITY, .TOWN, .COUNTY, .STATE, .COUNTRY, .FARM, ..." },
    { name: "lat", description: "Latitude, stored as text ('' when not recorded)" },
    { name: "long", description: "Longitude, stored as text" },
    { name: "code", description: "Postal code" },
    PRIVATE,
    CHANGE,
  ],
  relationships: [
    { name: "enclosed_by", description: "The place this one sits inside; chains with itself as far up as you like" },
  ],
  collections: [
    { name: "enclosing_places", description: "The place(s) this one is inside of, when there is more than one" },
    NOTES, CITATIONS, MEDIA, TAGS,
  ],
};

const REPOSITORY_HELP: SearchHelp = {
  typeName: "Repository",
  examples: [
    { expr: "like(name, '%Library%')", description: "Anything with Library in its name" },
    { expr: "type.value == RepositoryType.CEMETERY", description: "Cemeteries only" },
    { expr: "not exists(notes)", description: "No notes written about it" },
  ],
  fields: [
    GRAMPS_ID,
    { name: "name", description: "The repository's name -- the Name column" },
    { name: "type.value", description: "RepositoryType.LIBRARY, .ARCHIVE, .CHURCH, .CEMETERY, .WEBSITE, ..." },
    PRIVATE,
    CHANGE,
  ],
  collections: [NOTES, TAGS],
};

const SOURCE_HELP: SearchHelp = {
  typeName: "Source",
  examples: [
    { expr: "like(author, '%Smith%')", description: "Sources by an author named Smith" },
    { expr: "'census' in title", description: "The title mentions a census" },
    { expr: "author == ''", description: "No author recorded" },
    { expr: "exists(repositories)", description: "Held by at least one repository" },
  ],
  fields: [
    GRAMPS_ID,
    { name: "title", description: "The source's title -- the Title column" },
    { name: "author", description: "The author -- the Author column" },
    { name: "abbrev", description: "The short form of the title" },
    { name: "pubinfo", description: "Publication information" },
    PRIVATE,
    CHANGE,
  ],
  collections: [
    { name: "repositories", description: "Repositories holding this source" },
    NOTES, MEDIA, TAGS,
  ],
};

const CITATION_HELP: SearchHelp = {
  typeName: "Citation",
  examples: [
    { expr: "confidence >= Citation.CONF_HIGH", description: "The ones you consider reliable" },
    { expr: "source.title == 'Census Records'", description: "Citations of one particular source" },
    { expr: "like(page, '%p. 12%')", description: "A particular page reference" },
    { expr: "date.sortval < Date('Jan 1, 1900')", description: "Citing a record from before 1900" },
  ],
  fields: [
    GRAMPS_ID,
    { name: "confidence", description: "Citation.CONF_VERY_LOW, .CONF_LOW, .CONF_NORMAL, .CONF_HIGH, .CONF_VERY_HIGH" },
    { name: "page", description: "The volume/page reference -- the Page column" },
    { name: "date.sortval", description: "The date of the cited record, as a comparable number" },
    { name: "source_handle", description: "The source's internal id -- source below is usually what you want" },
    PRIVATE,
    CHANGE,
  ],
  relationships: [
    { name: "source", description: "The source being cited, e.g. source.title, source.author" },
  ],
  collections: [NOTES, MEDIA, TAGS],
};

const MEDIA_HELP: SearchHelp = {
  typeName: "Media",
  examples: [
    { expr: "like(mime, 'image/%')", description: "Pictures only" },
    { expr: "'wedding' in desc", description: "The description mentions a wedding" },
    { expr: "like(path, '%.pdf')", description: "PDF files" },
    { expr: "not exists(citations)", description: "Nothing citing it" },
  ],
  fields: MEDIA_FIELDS,
  collections: [NOTES, CITATIONS, TAGS],
};

const NOTE_HELP: SearchHelp = {
  typeName: "Note",
  examples: [
    { expr: "'TODO' in text.string", description: "Notes mentioning TODO anywhere" },
    { expr: "like(text.string, 'Check %')", description: "Notes starting with 'Check '" },
    { expr: "type.value == NoteType.RESEARCH", description: "Research notes only" },
    { expr: "exists(tags, name == 'todo')", description: "Notes carrying a particular tag" },
  ],
  fields: NOTE_FIELDS,
  collections: [TAGS],
};

const TAG_HELP: SearchHelp = {
  typeName: "Tag",
  examples: [
    { expr: "like(name, '%todo%')", description: "Tags with todo in the name" },
    { expr: "priority == 0", description: "Tags at the top of the list" },
    { expr: "color == '#FF0000'", description: "Tags of one colour" },
  ],
  fields: [
    { name: "name", description: "The tag's name -- the Name column" },
    { name: "color", description: "The colour, as '#RRGGBB'" },
    { name: "priority", description: "Sort order, a number (0 first)" },
    CHANGE,
  ],
};

// Media and Note under a fixed tag filter (see GENERATED_VIEW and
// MESSAGES_VIEW's baseFilter) -- same fields as the tables they come from,
// so those lists are reused verbatim; only the scope note and the examples
// are their own.
const GENERATED_HELP: SearchHelp = {
  typeName: "Media",
  scopeNote:
    "This list already shows only the reports and exports that have been generated -- " +
    "they are stored as media, so a search here searches those media records, and is " +
    "narrowed down further within the list rather than reaching the rest of your media.",
  examples: [
    { expr: "exists(tags, name == 'report')", description: "Reports only, leaving out exports" },
    { expr: "exists(tags, name == 'export')", description: "Exports only" },
    { expr: "'Descendant' in desc", description: "Whatever was produced by a Descendant report" },
    { expr: "mime == 'application/pdf'", description: "PDFs only" },
  ],
  fields: MEDIA_FIELDS,
  collections: [NOTES, CITATIONS, TAGS],
};

const MESSAGES_HELP: SearchHelp = {
  typeName: "Note",
  scopeNote:
    "This list already shows only the messages people have left on this tree -- they are " +
    "stored as notes, so a search here searches those notes, and is narrowed down further " +
    "within the list rather than reaching the rest of your notes.",
  examples: [
    { expr: "'urgent' in text.string", description: "Messages mentioning something urgent" },
    { expr: "like(text.string, 'owner:%')", description: "Messages written by one person -- their name comes first, before the colon" },
    { expr: "exists(tags, name == 'todo-done')", description: "Messages that have been marked done" },
    { expr: "not exists(tags, name == 'todo-done')", description: "Messages still outstanding" },
  ],
  // The By and Message columns are two halves of one stored string (see
  // authoredText.ts), so there is no separate author field to search --
  // text.string holds "author: message" and matching either half means
  // matching that one field.
  fields: NOTE_FIELDS,
  collections: [TAGS],
};

/** Keyed by ViewConfig.key -- by view rather than by object type, since two
 * views over the same table (Media/Output, Notes/Messages) hold different
 * rows and want different examples. A view with no entry simply gets no
 * help button, so adding a view isn't blocked on writing its help first. */
const SEARCH_HELP: Record<string, SearchHelp> = {
  person: PERSON_HELP,
  family: FAMILY_HELP,
  event: EVENT_HELP,
  place: PLACE_HELP,
  repository: REPOSITORY_HELP,
  source: SOURCE_HELP,
  citation: CITATION_HELP,
  media: MEDIA_HELP,
  note: NOTE_HELP,
  tag: TAG_HELP,
  generated: GENERATED_HELP,
  messages: MESSAGES_HELP,
};

export function getSearchHelp(view: ViewConfig): SearchHelp | undefined {
  return SEARCH_HELP[view.key];
}
