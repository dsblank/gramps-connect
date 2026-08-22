// Global "drop a file anywhere to add it as Media" handling -- attaches to
// window rather than any one drop-zone element, since there's no existing
// drag-and-drop in the app to collide with (see the plan this implements).
// Three outcomes, decided at drop time by resolveDropTarget(), in priority
// order:
//   1. An edit dialog for a media-capable type (MEDIA_CAPABLE_TYPES) is the
//      frontmost open draft: the file(s) upload and attach to *that*
//      draft's media_list, the same patch shape MediaListField's own
//      onAdded would produce -- Save/Cancel on the dialog governs them
//      exactly like any other field edit made through the UI.
//   2. No such dialog is open (or the frontmost one can't hold media), but
//      the active view is itself a media-capable type and has a selected
//      row: the file(s) upload and attach directly to *that* record via a
//      real PUT (refListApi.ts's attachRefListEntry -- same GET-then-PUT
//      shape AttachControl.tsx already uses for "pick an existing Media"
//      from the detail pane), since there's no open dialog/draft to defer
//      the change to.
//   3. Otherwise: the file(s) just become new, unattached Media objects,
//      same as dropping them into the Media list directly.
import { useEffect, useRef, useState } from "react";
import { notifications } from "@mantine/notifications";
import { getToken } from "../auth/auth";
import { uploadMediaFile } from "../store/jobsApi";
import { attachRefListEntry } from "../store/refListApi";
import { getViewStore } from "../store/registry";
import { DRAFT_TYPE_LABELS, MEDIA_CAPABLE_TYPES, type DraftEntry, type DraftType, type UseDraftStack } from "../store/draftStack";
import { VIEWS, type ViewConfig } from "../store/views";

export interface MediaDropState {
  /** A file is currently being dragged over the window -- MediaDropOverlay
   * renders only while this is true. */
  active: boolean;
  /** What a drop would do right now, for the overlay's own text -- null
   * whenever `active` is false. */
  targetLabel: string | null;
}

interface MediaRef {
  _class: "MediaRef";
  ref: string;
}

type DropTarget =
  | { kind: "draft"; draft: DraftEntry }
  | { kind: "viewed"; view: ViewConfig; handle: string }
  | { kind: "none" };

/** Priority 1: the frontmost open dialog (the last of `openHandles` --
 * Mantine's Modal.Stack always keeps the most recently opened/shown modal
 * on top and blocks pointer events on any dialog beneath it, so it's also
 * the only one a drop could ever land on), provided it's a media-capable
 * type and has actually finished loading (an edit draft mid-fetch has no
 * media_list to safely read yet). A non-media-capable frontmost draft
 * (Repository, Note, Tag, Story) is *not* walked up to its `openedFrom`
 * parent, and doesn't block priority 2 either -- it's treated the same as
 * no dialog open, falling through to whatever's being viewed underneath.
 *
 * Priority 2: the active view itself, if it's a media-capable type with a
 * row currently selected -- `activeKey` doubles as both the view's
 * ViewConfig key and its DraftType (PERSON_VIEW.key === "person", etc.),
 * and the selection lives on that view's own ViewStore, so no React state
 * needs to be threaded down from App.tsx for this to work. */
function resolveDropTarget(draftStack: UseDraftStack, activeKey: string): DropTarget {
  const topHandle = draftStack.openHandles[draftStack.openHandles.length - 1];
  if (topHandle) {
    const draft = draftStack.stack.find((d) => d.handle === topHandle);
    if (draft?.active && draft.status === "ready" && MEDIA_CAPABLE_TYPES.has(draft.type)) {
      return { kind: "draft", draft };
    }
  }
  if (MEDIA_CAPABLE_TYPES.has(activeKey as DraftType)) {
    const view = VIEWS.find((v) => v.key === activeKey);
    const handle = view ? getViewStore(activeKey).getSnapshot().selectedHandle : null;
    if (view && handle) return { kind: "viewed", view, handle };
  }
  return { kind: "none" };
}

function hasFiles(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
}

async function handleDrop(files: File[], draftStack: UseDraftStack, activeKey: string) {
  const target = resolveDropTarget(draftStack, activeKey);
  const token = await getToken();
  const uploaded: string[] = [];
  for (const file of files) {
    try {
      uploaded.push(await uploadMediaFile(token, file));
    } catch (err: any) {
      notifications.show({ color: "red", title: "Media upload failed", message: err.message ?? String(err) });
    }
  }
  if (uploaded.length === 0) return;
  const plural = uploaded.length > 1 ? `${uploaded.length} files` : "File";

  if (target.kind === "draft") {
    const existing = (target.draft.data.media_list as MediaRef[] | undefined) ?? [];
    const added: MediaRef[] = uploaded.map((ref) => ({ _class: "MediaRef", ref }));
    draftStack.updateDraft(target.draft.handle, { media_list: [...existing, ...added] });
    notifications.show({
      color: "green",
      title: `${plural} added`,
      message: `Attached to the open ${DRAFT_TYPE_LABELS[target.draft.type]} dialog`,
    });
    return;
  }

  if (target.kind === "viewed") {
    try {
      // Sequential, not Promise.all: attachRefListEntry is its own
      // GET-then-PUT round trip, so concurrent calls for more than one
      // dropped file would race and each overwrite the other's append.
      for (const ref of uploaded) {
        await attachRefListEntry(token, target.view, target.handle, "media_list", { _class: "MediaRef", ref });
      }
      getViewStore(target.view.key).touchSelected(target.handle);
      getViewStore("media").requeryDebounced();
      notifications.show({
        color: "green",
        title: `${plural} added`,
        message: `Attached to the selected ${DRAFT_TYPE_LABELS[target.view.key as DraftType]}`,
      });
    } catch (err: any) {
      notifications.show({ color: "red", title: "Couldn't attach media", message: err.message ?? String(err) });
    }
    return;
  }

  getViewStore("media").requeryDebounced();
  notifications.show({ color: "green", title: `${plural} added`, message: "Added to the Media list" });
}

export function useMediaDrop(draftStack: UseDraftStack, activeKey: string): MediaDropState {
  const [dragCount, setDragCount] = useState(0);
  // Re-read via refs inside the listeners rather than putting these in the
  // effect's deps -- useDraftStack() returns a fresh object every render
  // and activeKey changes on every navigation, and window-level listeners
  // have no reason to be torn down and re-added that often.
  const draftStackRef = useRef(draftStack);
  draftStackRef.current = draftStack;
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;

  useEffect(() => {
    function onDragEnter(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragCount((n) => n + 1);
    }
    function onDragOver(e: DragEvent) {
      // preventDefault() here (not just on dragenter) is what actually
      // allows a drop -- omitting it makes the browser reject the drop and
      // navigate to the file instead.
      if (!hasFiles(e)) return;
      e.preventDefault();
    }
    function onDragLeave(e: DragEvent) {
      if (!hasFiles(e)) return;
      setDragCount((n) => Math.max(0, n - 1));
    }
    function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragCount(0);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) void handleDrop(files, draftStackRef.current, activeKeyRef.current);
    }
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  if (dragCount <= 0) return { active: false, targetLabel: null };
  const target = resolveDropTarget(draftStackRef.current, activeKeyRef.current);
  const targetLabel =
    target.kind === "draft"
      ? `Attach to the open ${DRAFT_TYPE_LABELS[target.draft.type]} dialog`
      : target.kind === "viewed"
      ? `Attach to the selected ${DRAFT_TYPE_LABELS[target.view.key as DraftType]}`
      : "Add to the Media list";
  return { active: true, targetLabel };
}
