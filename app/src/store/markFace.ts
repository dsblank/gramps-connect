// Marking someone's face in a photo straight from the full-size photo view
// (ImageLightbox), anywhere in the app outside the Evidence Board (which
// stages the same change as a loose end instead). It's written at once as
// ONE transaction, through the board's own save path, so it's one entry in
// History and the notice's Undo takes all of it back, including a person
// created for the face.
import { applyChanges, ChangeBuilder } from "./board/changes";
import { newPerson, setMediaRegion, type Region } from "./board/links";
import { loadRecords, type Records } from "./board/records";
import { saveBoard, undoSave, type SavedBoard } from "./board/save";
import { titleOf } from "./board/view";

/** Who the box is: someone in the tree, or a new person by name. */
export type FaceWho = { handle: string; label: string } | { first: string; surname: string };

export function faceWhoLabel(who: FaceWho): string {
  return "handle" in who ? who.label : [who.first, who.surname].filter(Boolean).join(" ");
}

/** Builds the change: `who` (made first, when new) is in photo `media`,
 * with their face at `rect`. `base` must hold an existing person's record. */
export function buildFace(b: ChangeBuilder, media: string, rect: number[], who: FaceWho): string {
  const person = "handle" in who ? who.handle : newPerson(b, { first: who.first, surname: who.surname });
  setMediaRegion(b, person, media, rect as Region);
  return person;
}

/** Writes the face now. Resolves to the saved transaction, for Undo. */
export async function markFaceNow(media: string, rect: number[], who: FaceWho): Promise<SavedBoard | null> {
  const base: Records = "handle" in who ? await loadRecords("Person", [who.handle]) : {};
  if ("handle" in who && !base[who.handle]) throw new Error("That person isn't in the tree any more, or you can't see them.");
  const b = new ChangeBuilder(base);
  const person = buildFace(b, media, rect, who);
  const change = b.change("face");
  const name = titleOf(person, applyChanges(base, [change]));
  return saveBoard(base, [change], `Mark face: ${name}`);
}

export { undoSave as undoMarkFace };
