import { Badge, Group } from "@mantine/core";
import { getToken, hasPermissions } from "../../../auth/auth";
import { detachRefListEntry } from "../../../store/refListApi";
import { EDITABLE_TYPES, type DraftType } from "../../../store/draftStack";
import { TAG_VIEW } from "../../../store/views";
import { AttachControl } from "../AttachControl";
import { CircleGlyphButton } from "../../CircleGlyphButton";
import { SectionShell, zipHandles } from "./shared";
import { gtkColorToCss } from "../color";
import type { SectionProps } from "../types";

/** PrimaryObject.tag_list -- a plain handle list. Tags are simple enough
 * (name/color/priority, no sub-detail worth drilling into) that they're
 * rendered as plain colored badges rather than full RefRows; clicking one
 * still navigates like any other reference. Detach uses a small
 * CircleGlyphButton inside the badge's rightSection rather than RefRow's
 * "−", since there's no RefRow here to hang it off. */
export function TagsSection({ type, view, detail, onNavigate, onRefetch }: SectionProps) {
  const rows = zipHandles<{ handle: string; name: string; color?: string }>(detail.tag_list, detail.extended?.tags);
  // See NotesSection.tsx's identical gate -- every editable type's own
  // Tags now live in its own edit dialog's field.
  const canAttach = hasPermissions("EditObject") && !EDITABLE_TYPES.includes(type as DraftType);
  if (rows.length === 0 && !canAttach) return null;

  async function handleRemove(handle: string, name: string) {
    if (!window.confirm(`Remove the tag "${name}" from this ${view.key}? This does not delete the tag itself.`)) return;
    const token = await getToken();
    await detachRefListEntry(token, view, detail.handle, "tag_list", handle);
    onRefetch?.();
  }

  return (
    <SectionShell label="Tags">
      <Group gap={6} align="center">
        {rows.map(({ handle, target }) => (
          <Badge
            key={handle}
            size="md"
            variant="filled"
            color={gtkColorToCss(target?.color) || "gray"}
            style={{ cursor: "pointer" }}
            onClick={() => onNavigate("tag", handle)}
            rightSection={
              canAttach ? (
                <CircleGlyphButton
                  glyph="−"
                  label="Remove tag"
                  size={14}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(handle, target?.name ?? handle);
                  }}
                />
              ) : undefined
            }
          >
            {target?.name ?? handle}
          </Badge>
        ))}
      </Group>
      {canAttach && (
        <Group mt={rows.length > 0 ? "xs" : 0}>
          <AttachControl
            targetView={view}
            targetHandle={detail.handle}
            pickerView={TAG_VIEW}
            listField="tag_list"
            itemLabel="a tag"
            onAttached={() => onRefetch?.()}
          />
        </Group>
      )}
    </SectionShell>
  );
}
