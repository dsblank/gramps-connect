// Flat, non-reference fields that were only visible in the table column for
// that type and never made it into the detail panel -- unlike
// RELATED_CONFIG's sections (which are always references to *other*
// objects), these are plain facts about the primary object itself: a
// Source's author, a Citation's confidence, a Place's type. Same "data,
// not code" shape as RELATED_CONFIG/views.ts, since there's no reason
// these six types' handful of fields need six bespoke components.
import type { ObjectDetail } from "../../store/objectDetail";
import { displayConfidence } from "../../store/views";
import { displayDate } from "./summary";
import { formatDisplayName, nameFormatFor, type RawName } from "../../store/nameDisplay";
import { t } from "../../i18n/i18n";

interface Name extends RawName {
  type?: string;
  date?: unknown;
}

function formatName(name: Name): string {
  const full = formatDisplayName(name);
  return name.type ? `${full} (${name.type})` : full;
}

export interface DetailField {
  label: string;
  value: (detail: ObjectDetail) => string;
}

/** Whether the primary name's display format (nameFormatFor) already shows
 * one of these codes -- case-insensitively, since %N is just %n upper-cased. */
function formatShows(name: Name, ...codes: string[]): boolean {
  const format = nameFormatFor(name).toLowerCase();
  return codes.some((code) => format.includes(`%${code}`));
}

/** A part of the person's primary name, shown only when the title above
 * (the name in its display format) leaves it out -- so a nickname, call
 * name, title etc. entered in the name editor is visible somewhere without
 * repeating what the title already says. %x ("common": nickname, else call
 * name) counts as showing whichever of the two it picks. */
function primaryNamePart(
  label: string,
  key: "title" | "suffix" | "call" | "nick" | "famnick",
  codes: string[],
): DetailField {
  return {
    label,
    value: (d) => {
      const name = (d.primary_name as Name | undefined) ?? {};
      const value = name[key]?.trim() ?? "";
      if (!value || formatShows(name, ...codes)) return "";
      if (formatShows(name, "x") && (key === "nick" || (key === "call" && !name.nick))) return "";
      return value;
    },
  };
}

export const DETAIL_FIELDS: Record<string, DetailField[]> = {
  person: [
    primaryNamePart("Title", "title", ["t"]),
    primaryNamePart("Suffix", "suffix", ["s"]),
    primaryNamePart("Call name", "call", ["c"]),
    primaryNamePart("Nickname", "nick", ["n"]),
    primaryNamePart("Family nickname", "famnick", ["g"]),
    {
      // Birth Name is the usual case and goes unsaid, as in the name editor.
      label: "Name type",
      value: (d) => {
        const type = (d.primary_name as Name | undefined)?.type ?? "";
        return type && type !== "Birth Name" ? t(type) : "";
      },
    },
    { label: "Name date", value: (d) => displayDate((d.primary_name as Name | undefined)?.date) },
    {
      label: "Also known as",
      value: (d) => (((d.alternate_names as Name[] | undefined) ?? []).map(formatName).filter(Boolean).join("; ")),
    },
  ],
  place: [
    { label: "Type", value: (d) => (d.place_type as string | undefined) ?? "" },
    {
      label: "Also known as",
      value: (d) => (((d.alt_names as { value?: string }[] | undefined) ?? []).map((n) => n.value).filter(Boolean).join("; ")),
    },
    { label: "Coordinates", value: (d) => [d.lat, d.long].filter(Boolean).join(", ") },
  ],
  repository: [
    { label: "Type", value: (d) => (d.type as string | undefined) ?? "" },
  ],
  source: [
    { label: "Author", value: (d) => (d.author as string | undefined) ?? "" },
    { label: "Publication info", value: (d) => (d.pubinfo as string | undefined) ?? "" },
    { label: "Abbreviation", value: (d) => (d.abbrev as string | undefined) ?? "" },
  ],
  citation: [
    { label: "Page", value: (d) => (d.page as string | undefined) ?? "" },
    { label: "Date", value: (d) => displayDate(d.date) },
    { label: "Confidence", value: (d) => displayConfidence(d.confidence) },
  ],
  event: [
    { label: "Type", value: (d) => (d.type as string | undefined) ?? "" },
    { label: "Date", value: (d) => displayDate(d.date) },
    { label: "Description", value: (d) => (d.description as string | undefined) ?? "" },
  ],
  media: [
    { label: "Date", value: (d) => displayDate(d.date) },
    { label: "Path", value: (d) => (d.path as string | undefined) ?? "" },
    { label: "MIME type", value: (d) => (d.mime as string | undefined) ?? "" },
  ],
  // See config.ts's RELATED_CONFIG.generated -- same underlying object
  // type as "media", same facts worth showing.
  generated: [
    { label: "Path", value: (d) => (d.path as string | undefined) ?? "" },
    { label: "MIME type", value: (d) => (d.mime as string | undefined) ?? "" },
  ],
  // Tag's color already gets its own swatch next to the title (see
  // RelatedPanel's TagSwatch) -- priority is the one field with nowhere
  // else to live.
  tag: [
    { label: "Order priority", value: (d) => (typeof d.priority === "number" ? String(d.priority) : "") },
  ],
  note: [
    { label: "Type", value: (d) => (d.type as string | undefined) ?? "" },
  ],
};
