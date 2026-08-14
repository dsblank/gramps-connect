import { zipRefs } from "../../../store/objectDetail";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** EventBase.event_ref_list -- shared verbatim by Person and Family (both
 * mix in EventBase), each ref carrying its own role (Primary/Witness/...). */
export function EventsSection({ detail, onNavigate }: SectionProps) {
  const rows = zipRefs(detail.event_ref_list, detail.extended?.events);
  if (rows.length === 0) return null;
  return (
    <SectionShell label="Events">
      {rows.map(({ ref, target }) => (
        <RefRow key={ref.ref} type="event" handle={ref.ref} obj={target} refMeta={ref} onNavigate={onNavigate} />
      ))}
    </SectionShell>
  );
}
