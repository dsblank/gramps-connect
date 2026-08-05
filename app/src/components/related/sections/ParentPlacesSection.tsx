import { zipRefs } from "../../../store/objectDetail";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** Place.placeref_list -- enclosing places (e.g. a city's placeref_list
 * points at its state/country); "places at this place" (the reverse) only
 * ever shows up via BacklinksSection. */
export function ParentPlacesSection({ detail, onNavigate }: SectionProps) {
  const rows = zipRefs(detail.placeref_list, detail.extended?.places);
  if (rows.length === 0) return null;
  return (
    <SectionShell label="Enclosing places" count={rows.length} defaultOpen>
      {rows.map(({ ref, target }) => (
        <RefRow key={ref.ref} type="place" handle={ref.ref} obj={target} refMeta={ref} onNavigate={onNavigate} />
      ))}
    </SectionShell>
  );
}
