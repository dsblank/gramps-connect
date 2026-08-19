import { hasPermissions } from "../../../auth/auth";
import { SOURCE_VIEW } from "../../../store/views";
import { SetFieldControl } from "../AttachControl";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** Citation.source_handle -- a singular ref, resolved by extend=all into
 * extended.source. Guards on `.handle` rather than object truthiness --
 * see PlaceSection's doc comment on gramps-web-api's `{}`-rather-than-
 * absent convention for an unset singular ref. Set live here (setRefField,
 * refListApi.ts) via SetFieldControl when missing, same as PlaceSection --
 * but no "−" once set: ObjectEditDialog.tsx's own citation field config
 * marks source_handle `required: true` (a Citation with no Source is
 * meaningless), so this section only ever fills in a missing/malformed
 * source, never blanks out a real one. */
export function SourceSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const source = detail.extended?.source as { handle?: string } | undefined;
  const canEdit = hasPermissions("EditObject");
  if (!source?.handle && !canEdit) return null;

  return (
    <SectionShell label="Source">
      {source?.handle ? (
        <RefRow type="source" handle={source.handle} obj={source} onNavigate={onNavigate} />
      ) : (
        <SetFieldControl
          targetView={view}
          targetHandle={detail.handle}
          pickerView={SOURCE_VIEW}
          field="source_handle"
          itemLabel="a source"
          onSet={() => onRefetch?.()}
        />
      )}
    </SectionShell>
  );
}
