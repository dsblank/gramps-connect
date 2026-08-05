import { SectionShell, RefRow, zipHandles } from "./shared";
import type { SectionProps } from "../types";

/** CitationBase.citation_list -- a plain handle list (no per-item ref
 * metadata; a citation reference is just "this object cites that citation",
 * nothing more), present on nearly every object type. */
export function CitationsSection({ detail, onNavigate }: SectionProps) {
  const rows = zipHandles(detail.citation_list, detail.extended?.citations);
  if (rows.length === 0) return null;
  return (
    <SectionShell label="Citations" count={rows.length}>
      {rows.map(({ handle, target }) => (
        <RefRow key={handle} type="citation" handle={handle} obj={target} onNavigate={onNavigate} />
      ))}
    </SectionShell>
  );
}
