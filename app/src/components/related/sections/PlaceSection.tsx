import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** Event.place -- a singular ref (not a list), still fully resolved by
 * extend=all into extended.place despite not being one of the documented
 * list-type ref fields (confirmed empirically against a live
 * gramps-web-api instance). gramps-web-api sends `{}` rather than omitting
 * the key when an event has no place set at all (same convention as
 * FamilyProfile's father/mother -- see the old PersonDetail.tsx's
 * hasPerson()), so the presence check has to be on `.handle`, not object
 * truthiness -- confirmed against a live event with `place: ""`. */
export function PlaceSection({ detail, onNavigate }: SectionProps) {
  const place = detail.extended?.place as { handle?: string } | undefined;
  if (!place?.handle) return null;
  return (
    <SectionShell label="Place">
      <RefRow type="place" handle={place.handle} obj={place} onNavigate={onNavigate} />
    </SectionShell>
  );
}
