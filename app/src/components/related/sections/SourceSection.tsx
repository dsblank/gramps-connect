import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** Citation.source_handle -- a singular ref, resolved by extend=all into
 * extended.source. Guards on `.handle` rather than object truthiness --
 * see PlaceSection's doc comment on gramps-web-api's `{}`-rather-than-
 * absent convention for an unset singular ref. */
export function SourceSection({ detail, onNavigate }: SectionProps) {
  const source = detail.extended?.source as { handle?: string } | undefined;
  if (!source?.handle) return null;
  return (
    <SectionShell label="Source">
      <RefRow type="source" handle={source.handle} obj={source} onNavigate={onNavigate} />
    </SectionShell>
  );
}
