import { getToken, hasPermissions } from "../../../auth/auth";
import { zipRefs } from "../../../store/objectDetail";
import { detachRefListEntry } from "../../../store/refListApi";
import { EVENT_VIEW } from "../../../store/views";
import { AttachControl } from "../AttachControl";
import { summaryLine } from "../summary";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";
import { t } from "../../../i18n/i18n";

/** EventBase.event_ref_list -- shared verbatim by Person and Family (both
 * mix in EventBase), each ref carrying its own role (Primary/Witness/...).
 * Add/remove live here (AttachControl, refListApi.ts), same as every other
 * list-with-metadata section -- a newly attached event defaults to role
 * "Primary". An existing entry's `role` still isn't editable from here
 * though, same MVP scope every other list field's extra per-entry field
 * already accepted -- fixing a wrong role after the fact is still
 * ParticipantsSection.tsx's own &#9998;, viewed from the Event's own page
 * (the reverse direction: editing the *participant's* event_ref_list, not
 * this record's). */
export function EventsSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const rows = zipRefs(detail.event_ref_list, detail.extended?.events);
  const canEdit = hasPermissions("EditObject");
  if (rows.length === 0 && !canEdit) return null;

  async function handleRemove(handle: string, target: unknown) {
    const summary = summaryLine("event", target) || "this event";
    if (!window.confirm(`Remove ${summary} from this ${view.key}? This does not delete the event itself.`)) return;
    const token = await getToken();
    await detachRefListEntry(token, view, detail.handle, "event_ref_list", handle);
    onRefetch?.();
  }

  return (
    <SectionShell label={t("Events")}>
      {rows.map(({ ref, target }) => (
        <RefRow
          key={ref.ref}
          type="event"
          handle={ref.ref}
          obj={target}
          refMeta={ref}
          onNavigate={onNavigate}
          onRemove={canEdit ? () => handleRemove(ref.ref, target) : undefined}
        />
      ))}
      {canEdit && (
        <AttachControl
          targetView={view}
          targetHandle={detail.handle}
          pickerView={EVENT_VIEW}
          listField="event_ref_list"
          buildEntry={(handle) => ({ _class: "EventRef", ref: handle, role: "Primary" })}
          itemLabel="an event"
          onAttached={() => onRefetch?.()}
        />
      )}
    </SectionShell>
  );
}
