// Opt-in flag for the browser Notification API side-channel to the
// completion toast (see App.tsx's job-status wiring) -- persisted across
// sessions like any other user preference (same localStorage pattern as
// columnWidths.ts), since re-granting this every reload would be tedious
// and the browser's own permission prompt already gates the actually
// consequential part. In-page only, per the plan: no service worker, no
// push subscriptions -- the tab has to be open for this to fire at all.
import { STORAGE_KEYS } from "./storageKeys";

const STORAGE_KEY = STORAGE_KEYS.browserNotifications;

export function isBrowserNotificationsEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

/** Why notifications can't be shown here, or null if they can (or the
 * browser will still ask): "insecure" -- the page isn't https:// or
 * localhost, where browsers withhold the API; "unsupported" -- no
 * Notification API at all; "denied" -- blocked for this site, which no
 * click can undo (only the browser's site settings can). */
export type NotificationBlocker = "insecure" | "unsupported" | "denied";

export function browserNotificationsBlocker(): NotificationBlocker | null {
  if (window.isSecureContext === false) return "insecure";
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return null;
}

/** Requests permission -- call only from a real click handler, since
 * Notification.requestPermission() silently no-ops outside a user gesture
 * in most browsers. Persists the opt-in only if granted; returns the
 * resulting enabled state. */
export async function enableBrowserNotifications(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  const permission = await Notification.requestPermission();
  const enabled = permission === "granted";
  if (enabled) localStorage.setItem(STORAGE_KEY, "true");
  return enabled;
}

export function disableBrowserNotifications(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Fires a real OS-level notification if (and only if) the user has opted
 * in and the browser permission is still granted -- a no-op otherwise, so
 * callers don't need their own guard. */
export function notifyBrowser(title: string, body?: string): void {
  if (!isBrowserNotificationsEnabled()) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification(title, { body });
}
