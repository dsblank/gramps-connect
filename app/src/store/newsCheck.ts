// The one Preferences > General switch for the app's daily look at the
// Gramps Connect project's own sites: the blog (blogNews.ts, for everyone)
// and the Gramplet Store (pyodidePoc/grampletStoreNews.ts, for users who
// can install Gramplets). A per-browser setting, default on. Off stops
// both fetches and hides their dots, counts and toasts.
//
// Before it existed the Store had a switch of its own; a browser that had
// turned that off keeps "off" here until the new switch is changed.
import { STORAGE_KEYS } from "./storageKeys";

export function isNewsCheckEnabled(): boolean {
  try {
    const value = localStorage.getItem(STORAGE_KEYS.newsCheck)
      ?? localStorage.getItem(STORAGE_KEYS.grampletStoreCheck);
    return value !== "false";
  } catch {
    return true;
  }
}

const listeners = new Set<(enabled: boolean) => void>();

/** Each check registers here to refresh its dot and, when switched on,
 * check right away. */
export function onNewsCheckChange(listener: (enabled: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setNewsCheckEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS.newsCheck, String(enabled));
    localStorage.removeItem(STORAGE_KEYS.grampletStoreCheck);
  } catch {
    // ignore -- falls back to the default (on)
  }
  listeners.forEach((l) => l(enabled));
}

/** True for a storage event that may have flipped the switch in another tab. */
export function isNewsCheckStorageKey(key: string | null): boolean {
  return key === null || key === STORAGE_KEYS.newsCheck || key === STORAGE_KEYS.grampletStoreCheck;
}
