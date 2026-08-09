// Opt-in flag for the browser Notification API side-channel to the
// completion toast (see App.tsx's job-status wiring) -- persisted across
// sessions like any other user preference (same localStorage pattern as
// columnWidths.ts), since re-granting this every reload would be tedious
// and the browser's own permission prompt already gates the actually
// consequential part. In-page only, per the plan: no service worker, no
// push subscriptions -- the tab has to be open for this to fire at all.
const STORAGE_KEY = "gramps-connect_browser_notifications_enabled";

export function isBrowserNotificationsEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
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
