import { zipRefs } from "../../../store/objectDetail";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** MediaBase.media_list -- unlike citation/note/tag lists, this one *is* a
 * wrapper (MediaRef: private/rect/note_list/citation_list around a bare
 * media handle), so it goes through zipRefs (metadata-preserving) rather
 * than zipHandles. */
export function MediaSection({ detail, onNavigate }: SectionProps) {
  const rows = zipRefs(detail.media_list, detail.extended?.media);
  if (rows.length === 0) return null;
  return (
    <SectionShell label="Media" count={rows.length}>
      {rows.map(({ ref, target }) => (
        <RefRow key={ref.ref} type="media" handle={ref.ref} obj={target} refMeta={ref} onNavigate={onNavigate} />
      ))}
    </SectionShell>
  );
}
