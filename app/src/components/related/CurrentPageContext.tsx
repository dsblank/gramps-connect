import { createContext, useContext } from "react";

export interface PageIdentity {
  type: string;
  handle: string;
}

/** The main table's current selection -- set once by AsideSplit (the only
 * place that knows it), read by RefRow (in every section, both panes) and
 * PanelHeader to recognize when a reference row or a panel's own title
 * points at the exact record already showing in the main table, so it can
 * render as bold plain text instead of a pointless self-link (e.g. a
 * family's Children list including the very person whose page you're
 * already on). A context rather than threading one more prop through
 * every section component's signature. */
export const CurrentPageContext = createContext<PageIdentity | null>(null);

export function useCurrentPage(): PageIdentity | null {
  return useContext(CurrentPageContext);
}

export function isCurrentPage(current: PageIdentity | null, type: string, handle: string): boolean {
  return current !== null && current.type === type && current.handle === handle;
}
