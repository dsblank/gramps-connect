import { createContext, useContext } from "react";

export interface PageIdentity {
  type: string;
  /** Every handle currently showing in the main table's selection -- more
   * than one entry only while a 2-selected split view (SelectionDetailView)
   * has both panes open; everywhere else this is a single-element array.
   * Kept as an array (rather than a single "self" handle) so that in split
   * view *either* pane's own record still counts as "self", not just
   * whichever one happens to be the click anchor -- otherwise the pane
   * that isn't the anchor would render its own title as a self-link, an
   * observed quirk from the single-handle version of this context. */
  handles: string[];
}

/** The main table's current selection -- set once by AsideSplit (the only
 * place that knows it), read by RefRow (in every section, both panes) and
 * PanelHeader to recognize when a reference row or a panel's own title
 * points at a record already showing in the main table, so it can render
 * as bold plain text instead of a pointless self-link (e.g. a family's
 * Children list including the very person whose page you're already on).
 * A context rather than threading one more prop through every section
 * component's signature. */
export const CurrentPageContext = createContext<PageIdentity | null>(null);

export function useCurrentPage(): PageIdentity | null {
  return useContext(CurrentPageContext);
}

export function isCurrentPage(current: PageIdentity | null, type: string, handle: string): boolean {
  return current !== null && current.type === type && current.handles.includes(handle);
}
