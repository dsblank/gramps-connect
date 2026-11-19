// Where the user last left the map (MapCanvas.tsx), so reopening it doesn't
// jump back to a world view. Same idea (and same purpose) as gramps-web's
// own getMapViewport/saveMapViewport. Kept per tree, like the home person
// (homePersonPreference.ts): different trees' families lived in different
// parts of the world, so one tree's spot is the wrong place to open
// another's map.
import { getTreeId } from "../auth/auth";
import { STORAGE_KEYS } from "./storageKeys";

const STORAGE_KEY = STORAGE_KEYS.mapViewport;

export interface Viewport {
  lat: number;
  lng: number;
  zoom: number;
}

type ViewportByTree = Record<string, Viewport>;

function isViewport(value: unknown): value is Viewport {
  const v = value as Partial<Viewport> | null;
  return !!v && typeof v.lat === "number" && typeof v.lng === "number" && typeof v.zoom === "number";
}

/** Same fallback key as homePersonPreference.ts, for a session whose token
 * carries no tree. */
function treeKey(): string {
  return getTreeId() ?? "unknown";
}

function writeAll(all: ViewportByTree): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // A private-mode/quota failure costs the user a remembered viewport and
    // nothing else -- not worth surfacing.
  }
}

/** Every tree's viewport. A value saved before viewports were per tree is a
 * single bare viewport: it's taken as the reading tree's -- where it was
 * left, as far as anyone can tell -- and rewritten that way at once, so a
 * different tree saving its own spot later can't claim it instead. */
function readAll(): ViewportByTree {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (isViewport(parsed)) {
      const converted = { [treeKey()]: parsed };
      writeAll(converted);
      return converted;
    }
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as ViewportByTree) : {};
  } catch {
    return {};
  }
}

export function loadViewport(): Viewport | null {
  const viewport = readAll()[treeKey()];
  return isViewport(viewport) ? { lat: viewport.lat, lng: viewport.lng, zoom: viewport.zoom } : null;
}

export function saveViewport(viewport: Viewport): void {
  const all = readAll();
  all[treeKey()] = viewport;
  writeAll(all);
}
