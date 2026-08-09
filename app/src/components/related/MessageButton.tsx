import { Image, Tooltip, UnstyledButton } from "@mantine/core";
import iconChat from "../../assets/icons/chat-message.svg";
import { hasPermissions } from "../../auth/auth";
import { attachNoteToObject } from "../../store/notesApi";
import type { ObjectDetail } from "../../store/objectDetail";
import type { ViewConfig } from "../../store/views";
import { TeamNoteComposer } from "../TeamNoteComposer";
import { RELATED_CONFIG } from "./config";

/** view.label is the sidebar's plural/collective name ("People", "Events",
 * "Places", ...) -- fine there, wrong in "Message about this ___" ("this
 * people"). Only the plural ones need overriding; Family/Media/Output read
 * fine singular already via view.label.toLowerCase(). */
const SINGULAR_LABEL: Partial<Record<string, string>> = {
  person: "person",
  event: "event",
  place: "place",
  repository: "repository",
  source: "source",
  citation: "citation",
};

function singularLabel(view: ViewConfig): string {
  return SINGULAR_LABEL[view.key] ?? view.label.toLowerCase();
}

/** Top-right icon on a RelatedPanel that starts a Gramps Connect message
 * "about" the object currently shown -- opens the same TeamNoteComposer
 * modal Messages' own trigger uses, but on save also attaches the new
 * note's handle to this object's own note_list (Gramps' own way for a Note
 * to reference another object; NotesSection.tsx already renders whatever's
 * in it), rather than putting any reference into the message text itself.
 *
 * Only offered where both are true:
 * - the object type actually has a note_list to attach to -- RELATED_CONFIG
 *   already encodes exactly that (it lists a "notes" section only for types
 *   NotesSection has something to render for), so reusing it here avoids a
 *   second, hand-maintained list of eligible view keys.
 * - the signed-in user holds both permissions the two calls this triggers
 *   actually require server-side: AddObject (POST-ing the note itself,
 *   base.py's GrampsObjectsProtectedResource.post) and EditObject (PUT-ing
 *   the target object to attach it, base.py's ...ProtectedResource.put). */
export function MessageButton({
  view,
  detail,
  onAttached,
}: {
  view: ViewConfig;
  detail: ObjectDetail;
  onAttached: () => void;
}) {
  const eligible = RELATED_CONFIG[view.key]?.includes("notes") ?? false;
  if (!eligible || !hasPermissions("AddObject", "EditObject")) return null;

  const label = `Message about this ${singularLabel(view)}`;

  return (
    <TeamNoteComposer
      renderTrigger={(open) => (
        <Tooltip label={label} withArrow>
          <UnstyledButton onClick={open} aria-label={label}>
            <Image src={iconChat} alt="" w={20} h={20} />
          </UnstyledButton>
        </Tooltip>
      )}
      onSaved={async (noteHandle, token) => {
        await attachNoteToObject(token, view, detail.handle, noteHandle);
        onAttached();
      }}
    />
  );
}
