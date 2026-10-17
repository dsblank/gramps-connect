// Telling the user the search index is still catching up after an import or
// restore. gramps-web-api v3.24.0+ (#1046) answers those as soon as the data
// is committed and updates the search index afterwards in separate tasks,
// listed in the result's `index_tasks` -- until they finish, search can miss
// the new records. ImportDialog.tsx/RestoreBackupDialog.tsx reload the page
// right after, so the task ids are handed across the reload in
// sessionStorage and watched from App.tsx once the app is back up. Older
// servers reindex inside the import itself and list nothing, so this never
// shows for them.
import { notifications } from "@mantine/notifications";
import { getToken } from "../auth/auth";
import { getTaskStatus } from "./jobsApi";
import { t } from "../i18n/i18n";

const STORAGE_KEY = "gramps-connect.pendingIndexTasks";
const NOTIFICATION_ID = "search-index-updating";
const POLL_MS = 2000;

/** The ids in an import/restore result's `index_tasks` ([{id, href}, ...]),
 * or [] for a result without any. */
export function indexTaskIds(result: unknown): string[] {
  const tasks = (result as { index_tasks?: unknown } | null)?.index_tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks.map((task) => (task as { id?: unknown })?.id).filter((id): id is string => typeof id === "string");
}

/** Called with an import/restore's result just before the page reloads. */
export function rememberIndexTasks(result: unknown): void {
  const ids = indexTaskIds(result);
  if (ids.length === 0) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // storage unavailable -- the reindex still runs, it just isn't announced
  }
}

/** Read, not removed: the ids stay until their tasks have finished, so a
 * reload mid-way (or StrictMode's mount-unmount-mount in development)
 * picks the watch back up instead of losing it. */
function readRememberedTasks(): string[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** The task's final state, polling until it leaves PENDING/STARTED/
 * PROGRESS. A lookup that fails (a task row already expired, say) counts as
 * finished: there's nothing left to wait for. */
async function settle(taskId: string, isCancelled: () => boolean): Promise<string> {
  while (!isCancelled()) {
    try {
      const { state } = await getTaskStatus(await getToken(), taskId);
      if (state !== "PENDING" && state !== "STARTED" && state !== "PROGRESS") return state;
    } catch {
      return "UNKNOWN";
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return "CANCELLED";
}

/** Shows a "search index updating" notification while any remembered
 * reindex task runs, replaced by the outcome once they all have. Returns a
 * cleanup that stops polling (for App.tsx's effect). */
export function watchRememberedIndexTasks(): () => void {
  const ids = readRememberedTasks();
  if (ids.length === 0) return () => {};
  let cancelled = false;
  notifications.show({
    id: NOTIFICATION_ID,
    loading: true,
    autoClose: false,
    withCloseButton: false,
    title: t("Updating the search index"),
    message: t("Search may not find the newly imported records until this finishes."),
  });
  void Promise.all(ids.map((id) => settle(id, () => cancelled))).then((states) => {
    if (cancelled) return;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // nothing to clean up if storage is unavailable
    }
    const failed = states.includes("FAILURE");
    notifications.update({
      id: NOTIFICATION_ID,
      loading: false,
      withCloseButton: true,
      autoClose: failed ? false : 4000,
      color: failed ? "red" : "green",
      title: failed ? t("Search index update failed") : t("Search index updated"),
      message: failed
        ? t("Search may miss some records. Tools → Rebuild Search Index… can fix it.")
        : t("Search now includes the newly imported records."),
    });
  });
  return () => {
    cancelled = true;
    notifications.hide(NOTIFICATION_ID);
  };
}
