import { useEffect } from "react";

/** Sets document.title -- the app never touched this before, so every
 * browser-history entry (Back/Forward's dropdown, bookmarks, ...) showed
 * the same static "Gramps Connect" from index.html regardless of which
 * record was actually open. `undefined` is a deliberate no-op (not "clear
 * the title") -- see AsideSplit/RelatedPanel's own callers for why: one
 * sets a generic view-level title when nothing's selected, the other
 * overrides it with the specific record's title once loaded, and neither
 * should stomp on the other by resetting to a placeholder in between. */
export function useDocumentTitle(title: string | undefined): void {
  useEffect(() => {
    if (title !== undefined) document.title = title;
  }, [title]);
}
