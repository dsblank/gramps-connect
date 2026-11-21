// Links written for Gramps Web: "/person/I0044", "/media/O0123", ... Gramps
// Web routes by real path and by Gramps ID; gramps-connect routes by hash
// and by handle (hash.ts). Tools built for Gramps Web (e.g. Bifrost, which
// writes "<gramps url>/media/<Gramps ID>" into Paperless and its own UI)
// and links people have saved or pasted from Gramps Web therefore point at
// paths this app would otherwise just open on Home.
//
// Both servers that ship this app (gramps-web-api's STATIC_PATH hosting,
// Docker and desktop alike; Vite in dev) already answer an extension-free
// path with index.html, so all that's left is on the client: notice such a
// path at startup, swap it for the app's own root, and once signed in look
// the Gramps ID up and open that record.
//
// The pending link waits in sessionStorage rather than module state so it
// survives the page reloading while the visitor signs in.
import { notifications } from "@mantine/notifications";
import { API_BASE } from "./config";
import { formatHash } from "./hash";
import { apiFetch } from "./store/apiFetch";
import { STORAGE_KEYS } from "./store/storageKeys";
import { t } from "./i18n/i18n";

/** Gramps Web's path segment -> this app's view key and the list endpoint
 * that takes `?gramps_id=`. Gramps Web's segment is the view key here too. */
const GRAMPS_WEB_TYPES: Record<string, string> = {
  person: "people",
  family: "families",
  event: "events",
  place: "places",
  source: "sources",
  citation: "citations",
  repository: "repositories",
  note: "notes",
  media: "media",
};

/** What a record is called in the "not found" message. */
const TYPE_LABELS: Record<string, string> = {
  person: "Person",
  family: "Family",
  event: "Event",
  place: "Place",
  source: "Source",
  citation: "Citation",
  repository: "Repository",
  note: "Note",
  media: "Media",
};

export interface GrampsWebLink {
  /** The app's own root: everything in the path before the Gramps Web
   * route, so an app served under a sub-path keeps it. Ends in "/". */
  base: string;
  viewKey: string;
  grampsId: string;
}

const PATH_RE = new RegExp(`^(.*/)(${Object.keys(GRAMPS_WEB_TYPES).join("|")})/([^/]+)/?$`);

/** Reads a Gramps Web record path ("/media/O0123", also behind a sub-path),
 * or null for any other path. */
export function parseGrampsWebPath(pathname: string): GrampsWebLink | null {
  const m = PATH_RE.exec(pathname);
  if (!m) return null;
  let grampsId: string;
  try {
    grampsId = decodeURIComponent(m[3]);
  } catch {
    return null;
  }
  if (!grampsId) return null;
  return { base: m[1], viewKey: m[2], grampsId };
}

/** Run once at startup, before anything reads the location: when the page
 * was opened on a Gramps Web record path, remembers the record and puts the
 * address bar back on the app's root (relative URLs resolve from there, and
 * a reload doesn't redo this). A hash already present wins -- that's this
 * app's own route -- and only the path is cleaned up. */
export function captureGrampsWebLink(): void {
  const link = parseGrampsWebPath(window.location.pathname);
  if (!link) return;
  const hash = window.location.hash;
  if (!hash || hash === "#" || hash === "#/") {
    try {
      sessionStorage.setItem(STORAGE_KEYS.pendingGrampsWebLink, JSON.stringify(link));
    } catch {
      // No storage (private window, blocked site data): the link just opens Home.
    }
  }
  window.history.replaceState(window.history.state, "", link.base + window.location.search + hash);
}

function takePending(): GrampsWebLink | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.pendingGrampsWebLink);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEYS.pendingGrampsWebLink);
    const link = JSON.parse(raw) as GrampsWebLink;
    return GRAMPS_WEB_TYPES[link?.viewKey] && typeof link.grampsId === "string" ? link : null;
  } catch {
    return null;
  }
}

/** Run once signed in: opens the record a captured Gramps Web link named, in
 * place of Home (replacing the history entry, so Back doesn't land on a
 * Home page the visitor never asked for), or says it isn't in this tree. */
export async function openPendingGrampsWebLink(token: string): Promise<void> {
  const link = takePending();
  if (!link) return;
  const url = `${API_BASE}/api/${GRAMPS_WEB_TYPES[link.viewKey]}/?gramps_id=${encodeURIComponent(link.grampsId)}&keys=handle`;
  let handle: string | null = null;
  try {
    const res = await apiFetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const body = await res.json();
      handle = Array.isArray(body) && typeof body[0]?.handle === "string" ? body[0].handle : null;
    } else if (res.status !== 404) {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    console.error("failed to look up linked record", err);
  }
  if (handle) {
    window.location.replace(formatHash({ viewKey: link.viewKey, handle }));
    return;
  }
  notifications.show({
    color: "yellow",
    title: t("Link not found"),
    message: t("There is no {type} with ID {id} in this tree.")
      .replace("{type}", t(TYPE_LABELS[link.viewKey]))
      .replace("{id}", link.grampsId),
  });
}
