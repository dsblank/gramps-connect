import { Button, Text } from "@mantine/core";
import { hasPermissions } from "../../auth/auth";
import { attachNoteToObject, MESSAGE_TYPE } from "../../store/notesApi";
import { splitAuthorMessage } from "../../store/authoredText";
import type { ObjectDetail } from "../../store/objectDetail";
import type { ViewConfig } from "../../store/views";
import { MessageComposer } from "../MessageComposer";
import { RELATED_CONFIG } from "./config";
import { summaryLine } from "./summary";
import { zipHandles } from "./sections/shared";
import { t } from "../../i18n/i18n";

interface RawMessageNote {
  type?: string;
  text?: { string?: string };
  change?: number;
}

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

/** Top-right button on a RelatedPanel that starts a Gramps Connect message
 * "about" the object currently shown -- opens the same MessageComposer
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

  // Same two lines the panel header behind the modal shows for this object
  // (RelatedPanel.tsx's PanelHeader: summaryLine, falling back to the type
  // label when a type has nothing to summarize, then "ID: <gramps_id>"), so
  // the hint names the object the same way the rest of the app just did.
  const summary = summaryLine(view.key, detail) || view.label;
  const grampsId = typeof detail.gramps_id === "string" ? detail.gramps_id : "";

  // Same note_list NotesSection.tsx's own "Messages" sub-section reads --
  // this is just that same list, reshaped into {author, text, change} (via
  // authoredText.ts's splitAuthorMessage, same split NotesSection's "By"/
  // "Message" columns use) and sorted oldest-first, so the composer can
  // render it as a chat thread rather than the row list NotesSection shows.
  const history = zipHandles<RawMessageNote>(detail.note_list, detail.extended?.notes)
    .filter(({ target }) => target?.type === MESSAGE_TYPE)
    .map(({ target }) => {
      const { author, message } = splitAuthorMessage(target.text?.string ?? "");
      return { author: author ?? t("Unknown"), text: message, change: target.change };
    })
    .sort((a, b) => (a.change ?? 0) - (b.change ?? 0));

  return (
    <MessageComposer
      history={history}
      about={
        <>
          About this {singularLabel(view)}:{" "}
          <Text span fw={600} inherit>{summary}</Text>
          {grampsId ? ` (${grampsId})` : ""}
        </>
      }
      renderTrigger={(open) => (
        <Button variant="default" size="xs" onClick={open} aria-label={label}>
          {t("Message")}
        </Button>
      )}
      onSaved={async (noteHandle, token) => {
        await attachNoteToObject(token, view, detail.handle, noteHandle);
        onAttached();
      }}
    />
  );
}
