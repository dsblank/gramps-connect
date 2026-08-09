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

interface Name {
  first_name?: string;
  surname_list?: { surname?: string }[];
  type?: string;
}

function formatName(name: Name): string {
  const surname = name.surname_list?.[0]?.surname ?? "";
  const given = name.first_name ?? "";
  const full = [given, surname].filter(Boolean).join(" ");
  return name.type ? `${full} (${name.type})` : full;
}

export interface DetailField {
  label: string;
  value: (detail: ObjectDetail) => string;
}

export const DETAIL_FIELDS: Record<string, DetailField[]> = {
  person: [
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
    { label: "Confidence", value: (d) => displayConfidence(d.confidence) },
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
    { label: "Priority", value: (d) => (typeof d.priority === "number" ? String(d.priority) : "") },
  ],
};
