import { getToken, hasPermissions } from "../../../auth/auth";
import { setRefField } from "../../../store/refListApi";
import { PLACE_VIEW } from "../../../store/views";
import { SetFieldControl } from "../AttachControl";
import { summaryLine } from "../summary";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** Event.place -- a singular ref (not a list), still fully resolved by
 * extend=all into extended.place despite not being one of the documented
 * list-type ref fields (confirmed empirically against a live
 * gramps-web-api instance). gramps-web-api sends `{}` rather than omitting
 * the key when an event has no place set at all (same convention as
 * FamilyProfile's father/mother -- see the old PersonDetail.tsx's
 * hasPerson()), so the presence check has to be on `.handle`, not object
 * truthiness -- confirmed against a live event with `place: ""`. Set/clear
 * live here (setRefField, refListApi.ts) via SetFieldControl, the
 * singular-field counterpart to AttachControl -- unlike Citation's
 * source_handle, Event's place isn't `required` in ObjectEditDialog.tsx's
 * own field config, so clearing it is a legitimate state, not just a
 * fix-up for malformed data. */
export function PlaceSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const place = detail.extended?.place as { handle?: string } | undefined;
  const canEdit = hasPermissions("EditObject");
  if (!place?.handle && !canEdit) return null;

  async function handleClear() {
    const summary = summaryLine("place", place) || "this place";
    if (!window.confirm(`Remove ${summary} as this event's place? This does not delete the place itself.`)) return;
    const token = await getToken();
    await setRefField(token, view, detail.handle, "place", "");
    onRefetch?.();
  }

  return (
    <SectionShell label="Place">
      {place?.handle ? (
        <RefRow
          type="place"
          handle={place.handle}
          obj={place}
          onNavigate={onNavigate}
          onRemove={canEdit ? handleClear : undefined}
        />
      ) : (
        <SetFieldControl
          targetView={view}
          targetHandle={detail.handle}
          pickerView={PLACE_VIEW}
          field="place"
          itemLabel="a place"
          onSet={() => onRefetch?.()}
        />
      )}
    </SectionShell>
  );
}
