import { Badge } from "@mantine/core";
import { getToken, hasPermissions } from "../../../auth/auth";
import { confirmDialog } from "../../../store/confirmDialog";
import { detachRefListEntry } from "../../../store/refListApi";
import { TAG_VIEW } from "../../../store/views";
import { AttachControl } from "../AttachControl";
import { CircleGlyphButton } from "../../CircleGlyphButton";
import { SectionShell, zipHandles } from "./shared";
import { gtkColorToCss, readableTextOn } from "../color";
import { orderTagHandles } from "../../../store/tagOrder";
import type { SectionProps } from "../types";
import { t } from "../../../i18n/i18n";

/** PrimaryObject.tag_list -- a plain handle list. Tags are simple enough
 * (name/color/priority, no sub-detail worth drilling into) that they're
 * rendered as plain colored badges rather than full RefRows; clicking one
 * still navigates like any other reference. Badges are short, so they sit
 * on the header row itself (SectionShell's `action` slot, wrapping onto
 * further lines as needed) followed by the "+", rather than in a body of
 * their own -- the section is usually just one line. Detach uses a small
 * CircleGlyphButton inside the badge's rightSection rather than RefRow's
 * "−", since there's no RefRow here to hang it off. */
export function TagsSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const stored = zipHandles<{ handle: string; name: string; color?: string; priority?: number }>(
    detail.tag_list, detail.extended?.tags
  );
  // In priority order -- the order they win in (e.g. chart colors) -- not
  // the order they were added, which means nothing (as in Gramps).
  const tagByHandle = new Map(stored.flatMap(({ handle, target }) => (target ? [[handle, target] as const] : [])));
  const rowByHandle = new Map(stored.map((r) => [r.handle, r]));
  const rows = orderTagHandles(stored.map((r) => r.handle), tagByHandle).map((h) => rowByHandle.get(h)!);
  // See NotesSection.tsx's identical comment -- this live attach/detach is a
  // quicker path to tag_list than the edit dialog, not the only one.
  const canAttach = hasPermissions("EditObject");
  if (rows.length === 0 && !canAttach) return null;

  async function handleRemove(handle: string, name: string) {
    if (!(await confirmDialog(`Remove the tag "${name}" from this ${view.key}? This does not delete the tag itself.`))) return;
    const token = await getToken();
    await detachRefListEntry(token, view, detail.handle, "tag_list", handle);
    onRefetch?.();
  }

  return (
    <SectionShell
      label={t("Tags")}
      action={
        <>
          {rows.map(({ handle, target }) => {
            const css = gtkColorToCss(target?.color);
            return (
              <Badge
                key={handle}
                size="md"
                variant="filled"
                color={css || "gray"}
                // Filled badges always draw white text; a light tag color
                // needs black instead.
                c={readableTextOn(css)}
                style={{ cursor: "pointer" }}
                onClick={() => onNavigate("tag", handle)}
                rightSection={
                  canAttach ? (
                    <CircleGlyphButton
                      glyph="−"
                      label={t("Remove tag")}
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
            );
          })}
          {canAttach && (
            <AttachControl
              targetView={view}
              targetHandle={detail.handle}
              pickerView={TAG_VIEW}
              listField="tag_list"
              itemLabel="a tag"
              createType="tag"
              createData={(query) => (query ? { name: query } : {})}
              onAttached={() => onRefetch?.()}
            />
          )}
        </>
      }
    />
  );
}
