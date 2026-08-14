// One-line compact summaries of a raw Gramps object -- used by every
// section (forward refs and backlinks alike) and by ReferenceDetail's
// target header. Deliberately built off each type's *raw* serialized shape
// (confirmed against a live gramps-web-api instance: e.g. Person's
// `primary_name.first_name`/`surname_list[0].surname`, Event's
// `type`/`date`/`description`, Place's `title`, ...) rather than the
// display-ready `profile` shapes -- `extended.*` (which every section
// already has, positionally zipped via objectDetail.ts's zipRefs) resolves
// generically for every type, while a rich `profile` builder only exists
// for a handful of types (Person/Family/Place/Event), so summary building
// this way works uniformly across all 10.
import { formatDate, DateFormat, type GrampsDate } from "@gramps-connect/gramps-date";

// Exported: reused by detailFields.ts for Media's own `date` field.
export function displayDate(date: unknown): string {
  if (!date) return "";
  try {
    return formatDate(date as GrampsDate, { format: DateFormat.DAY_SHORT_MONTH_YEAR });
  } catch {
    return "";
  }
}

/** Accepts either shape a Person can arrive in: raw (extended.*'s
 * `primary_name` struct) or the display-ready `profile` shape (already has
 * `name_display` precomputed) -- some sections resolve via `extended`
 * (frel/mrel-bearing child refs need the raw Family alongside it), others
 * via `profile` (Person's own spouse/parent summaries, which `extend`
 * doesn't resolve past one level -- see FamiliesSection/ParentsSection). */
function personName(obj: any): string {
  if (obj?.name_display) return obj.name_display;
  const name = obj?.primary_name;
  const surname = name?.surname_list?.[0]?.surname ?? "";
  const given = name?.first_name ?? "";
  return [given, surname].filter(Boolean).join(" ") || "(unnamed)";
}

/** Truncates long free text (Note bodies, Source titles pulled from GEDCOM
 * imports, ...) for use inline in a reference row -- mirrors views.ts's
 * own `truncate()` for NOTE_VIEW's table column. */
function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function summaryText(type: string, obj: any): string {
  switch (type) {
    case "person":
      return personName(obj);
    case "family": {
      // Either shape: a raw Family's own extended.father/mother (fully
      // resolved when Family is the directly-fetched object), or the
      // profile-shaped father/mother already on a FamilyProfile (e.g.
      // Person's own profile.families[i] entries, which extend=all can't
      // resolve past one level of nesting).
      const father = obj.extended?.father ?? obj.father;
      const mother = obj.extended?.mother ?? obj.mother;
      const names = [father, mother].filter(Boolean).map(personName);
      return names.length > 0 ? names.join(" & ") : "(family)";
    }
    case "event": {
      const type_ = obj.type ?? "Event";
      const date = displayDate(obj.date);
      return [type_, date].filter(Boolean).join(": ") || obj.description || "(event)";
    }
    case "place":
      return obj.title || obj.name?.value || "(place)";
    case "repository":
      return obj.name || "(repository)";
    case "source":
      return obj.title || "(source)";
    case "citation": {
      // Either shape, same reasoning as family's father/mother above: a
      // directly-fetched Citation's own extended.source, or a profile-shaped
      // reference (getBacklinks' PROFILE_RESOLVED_BACKLINK_TYPES swap, or
      // CitationsSection's own zipRefs) whose `source` is already resolved.
      const source = obj.extended?.source ?? obj.source;
      const sourceTitle = source?.title ?? "";
      return [sourceTitle, obj.page].filter(Boolean).join(", ") || "(citation)";
    }
    case "media":
    case "generated":
      return obj.desc || obj.path || "(media)";
    case "note":
    case "messages":
      return truncate(obj.text?.string ?? "", 80) || "(note)";
    case "tag":
      return obj.name || "(tag)";
    default:
      return obj.handle ?? "";
  }
}

/** Prefixes a label with its record's gramps_id (per Gramps convention of
 * always identifying a record by its stable ID first) -- shared by every
 * list/picker row, not just summaryLine() below: RecordPicker.tsx,
 * AttachControl.tsx, FamilyEditDialog.tsx, and FamiliesSection/
 * ParentsSection's spouse/parent-name label overrides all build their own
 * text outside summaryLine's switch (flat query-list rows, or a name
 * standing in for the family it belongs to) and need the same prefix. Tag
 * is the one type with no gramps_id at all (gramps/gen/lib/tag.py), so `id`
 * is optional here rather than assumed present. */
export function withGrampsId(id: string | undefined, text: string): string {
  if (!id) return text;
  return text ? `[${id}] ${text}` : `[${id}]`;
}

/** Every list/detail row leads with the object's `gramps_id` (per Gramps
 * convention of always identifying records by their stable ID) followed by
 * the type-specific summary text built above. */
export function summaryLine(type: string, obj: any): string {
  if (!obj) return "";
  const text = summaryText(type, obj);
  const id = typeof obj.gramps_id === "string" ? obj.gramps_id : undefined;
  return withGrampsId(id, text);
}
